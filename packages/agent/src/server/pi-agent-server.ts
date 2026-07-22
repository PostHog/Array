import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerType } from "@hono/node-server";
import { serve } from "@hono/node-server";
import type { AgentConversationEvent, StoredLogEntry } from "@posthog/shared";
import { Hono } from "hono";
import { z } from "zod/v4";
import { createPiRpcClient, type PiRpcClient } from "../pi/rpc-client";
import {
  piRpcCommandSchema,
  type RpcCommand,
  sendPiRpcCommand,
} from "../pi/rpc-transport";
import { PiRuntime } from "../pi/runtime";
import { PostHogAPIClient } from "../posthog-api";
import { Logger } from "../utils/logger";
import { TaskRunEventStreamSender } from "./event-stream-sender";
import { type JwtPayload, JwtValidationError, validateJwt } from "./jwt";
import { jsonRpcRequestSchema } from "./schemas";
import type { AgentServerConfig } from "./types";

interface SseController {
  send(data: unknown): void;
  close(): void;
}

interface PiCloudSession {
  payload: JwtPayload;
  runtime: PiRuntime;
  sseController: SseController | null;
  unsubscribe: () => void;
}

const SESSION_SYNC_INTERVAL_MS = 5_000;
const COMPLETED_USER_MESSAGE_DELIVERY_LIMIT = 500;
const emptySchema = z.object({});

const userMessageCommandSchema = z.object({
  content: z.string().min(1),
  messageId: z.string().min(1).optional(),
});

const commandSchemas = {
  user_message: userMessageCommandSchema,
  cancel: emptySchema,
  "pi/rpc": z.object({ command: piRpcCommandSchema }),
} as const;

type PiCommandMethod = keyof typeof commandSchemas;

export class PiAgentServer {
  private readonly app: Hono;
  private readonly logger = new Logger({
    debug: true,
    prefix: "[PiAgentServer]",
  });
  private readonly posthogAPI: PostHogAPIClient;
  private readonly eventStreamSender: TaskRunEventStreamSender | null;
  private server: ServerType | null = null;
  private session: PiCloudSession | null = null;
  private initializationPromise: Promise<void> | null = null;
  private pendingEvents: Record<string, unknown>[] = [];
  private sessionReadyBootMs?: number;
  private sessionInitMs?: number;
  private sessionFile: string | null = null;
  private lastSyncedSessionContent = "";
  private sessionRevision = 0;
  private sessionSyncInterval: ReturnType<typeof setInterval> | null = null;
  private sessionSyncQueue: Promise<void> = Promise.resolve();
  private pendingLogEntries: StoredLogEntry[] = [];
  private logFlushQueue: Promise<void> = Promise.resolve();
  private readonly canceledSseControllers = new WeakSet<SseController>();
  private readonly userMessageDeliveries = new Map<string, Promise<unknown>>();
  private readonly completedUserMessageDeliveries = new Map<string, unknown>();

  constructor(private readonly config: AgentServerConfig) {
    this.posthogAPI = new PostHogAPIClient({
      apiUrl: config.apiUrl,
      projectId: config.projectId,
      getApiKey: () => config.apiKey,
      userAgent: `posthog/pi-cloud`,
    });
    this.eventStreamSender = config.eventIngestToken
      ? new TaskRunEventStreamSender({
          apiUrl: config.apiUrl,
          eventIngestBaseUrl: config.eventIngestBaseUrl,
          keepProxyStreamOpen: config.eventIngestKeepStreamOpen,
          projectId: config.projectId,
          taskId: config.taskId,
          runId: config.runId,
          token: config.eventIngestToken,
          logger: this.logger.child("EventIngest"),
          streamWindowMs: config.eventIngestStreamWindowMs,
        })
      : null;
    this.app = this.createApp();
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server = serve(
        { fetch: this.app.fetch, port: this.config.port },
        () => resolve(),
      );
    });

    const payload: JwtPayload = {
      task_id: this.config.taskId,
      run_id: this.config.runId,
      team_id: this.config.projectId,
      user_id: 0,
      distinct_id: "pi-agent-server",
      mode: this.config.mode,
    };
    await this.initializeSession(payload, null);
  }

  async stop(): Promise<void> {
    const session = this.session;
    if (this.sessionSyncInterval) {
      clearInterval(this.sessionSyncInterval);
      this.sessionSyncInterval = null;
    }
    if (session) {
      await session.runtime.client.abort().catch(() => undefined);
      await session.runtime.client.waitForIdle(5_000).catch(() => undefined);
      await this.syncTaskSession().catch((error) =>
        this.logger.error("Failed to sync Pi session during shutdown", error),
      );
      session.unsubscribe();
      await session.runtime.client.stop();
    }
    this.session = null;
    await this.flushConversationLog().catch((error) =>
      this.logger.error("Failed to persist Pi events during shutdown", error),
    );
    await this.eventStreamSender?.stop();
    this.server?.close();
    this.server = null;
  }

  async reportFatalError(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.broadcast({
      type: "pi_event",
      timestamp: new Date().toISOString(),
      event: {
        type: "runtime_error",
        timestamp: Date.now(),
        errorType: "agent_server_crash",
        message,
      } satisfies AgentConversationEvent,
    });
    await Promise.all([
      this.syncTaskSession(),
      this.flushConversationLog(),
    ]).catch((syncError) =>
      this.logger.error("Failed to persist crashed Pi session", syncError),
    );
    await this.posthogAPI
      .updateTaskRun(this.config.taskId, this.config.runId, {
        status: "failed",
        error_message: `Pi agent server crashed: ${message}`,
      })
      .catch(() => undefined);
    await this.eventStreamSender?.stop();
  }

  private createApp(): Hono {
    const app = new Hono();

    app.get("/health", (context) =>
      context.json({
        status: "ok",
        hasSession: this.session !== null,
        bootMs: this.sessionReadyBootMs,
        sessionInitMs: this.sessionInitMs,
      }),
    );

    app.get("/events", async (context) => {
      let payload: JwtPayload;
      try {
        payload = this.authenticate(context.req.header.bind(context.req));
      } catch (error) {
        return context.json(
          { error: error instanceof Error ? error.message : "Invalid token" },
          401,
        );
      }

      const encoder = new TextEncoder();
      let keepalive: ReturnType<typeof setInterval> | null = null;
      let sseController: SseController | null = null;
      const stream = new ReadableStream({
        start: async (controller) => {
          sseController = {
            send: (data) =>
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
              ),
            close: () => controller.close(),
          };
          keepalive = setInterval(() => {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          }, 25_000);
          await this.initializeSession(payload, sseController);
          if (this.session?.sseController !== sseController) {
            return;
          }
          this.replayPendingEvents();
          sseController.send({ type: "connected", run_id: payload.run_id });
        },
        cancel: () => {
          if (keepalive) {
            clearInterval(keepalive);
          }
          this.cancelSseController(sseController);
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    });

    app.post("/command", async (context) => {
      let payload: JwtPayload;
      try {
        payload = this.authenticate(context.req.header.bind(context.req));
      } catch (error) {
        return context.json(
          { error: error instanceof Error ? error.message : "Invalid token" },
          401,
        );
      }
      if (!this.session || this.session.payload.run_id !== payload.run_id) {
        return context.json({ error: "No active session for this run" }, 400);
      }

      const request = jsonRpcRequestSchema.safeParse(
        await context.req.json().catch(() => null),
      );
      if (!request.success) {
        return context.json({ error: "Invalid JSON-RPC request" }, 400);
      }

      const method = request.data.method as PiCommandMethod;
      const schema = commandSchemas[method];
      if (!schema) {
        return context.json({
          jsonrpc: "2.0",
          id: request.data.id,
          error: {
            code: -32601,
            message: `Unknown method: ${request.data.method}`,
          },
        });
      }
      const params = schema.safeParse(request.data.params ?? {});
      if (!params.success) {
        return context.json({
          jsonrpc: "2.0",
          id: request.data.id,
          error: { code: -32602, message: params.error.message },
        });
      }

      try {
        const result = await this.executeCommand(
          method,
          params.data as Record<string, unknown>,
        );
        return context.json({ jsonrpc: "2.0", id: request.data.id, result });
      } catch (error) {
        return context.json({
          jsonrpc: "2.0",
          id: request.data.id,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : "Unknown error",
          },
        });
      }
    });

    return app;
  }

  private async initializeSession(
    payload: JwtPayload,
    sseController: SseController | null,
  ): Promise<void> {
    if (this.session?.payload.run_id === payload.run_id) {
      this.installSseController(sseController);
      return;
    }
    if (this.initializationPromise) {
      await this.initializationPromise;
      this.installSseController(sseController);
      return;
    }

    const initializationPromise = this.createSession(payload);
    this.initializationPromise = initializationPromise;
    try {
      await initializationPromise;
    } finally {
      if (this.initializationPromise === initializationPromise) {
        this.initializationPromise = null;
      }
    }
    this.installSseController(sseController);
  }

  private async createSession(payload: JwtPayload): Promise<void> {
    const startedAt = Date.now();
    await this.waitForRepoReady();
    const taskRun = await this.posthogAPI.getTaskRun(
      payload.task_id,
      payload.run_id,
    );
    const task = await this.posthogAPI.getTask(payload.task_id);
    const state = (taskRun.state ?? {}) as Record<string, unknown>;
    const cwd = this.config.repositoryPath ?? "/tmp/workspace";
    if (!this.config.sandboxId) {
      throw new Error("Pi task session persistence requires a sandbox ID");
    }
    const sessionStorage = await this.posthogAPI.getTaskSession(
      payload.task_id,
      payload.run_id,
    );
    const persistedSessionContent =
      await this.posthogAPI.downloadTaskSession(sessionStorage);
    const sessionDir = join("/tmp", "posthog-pi-sessions", sessionStorage.id);
    await mkdir(sessionDir, { recursive: true });
    const restoredSessionFile = persistedSessionContent
      ? join(sessionDir, "session.jsonl")
      : undefined;
    if (restoredSessionFile) {
      await writeFile(restoredSessionFile, persistedSessionContent, "utf8");
    }
    this.lastSyncedSessionContent = persistedSessionContent;
    this.sessionRevision = sessionStorage.revision;

    const client = createPiRpcClient({
      cliPath: this.config.piRpcHostPath,
      cwd,
      sessionDir,
      model: this.config.model,
      sessionFile: restoredSessionFile,
      providerOptions: {
        apiKey: this.config.apiKey,
        baseUrl: this.posthogAPI.getLlmGatewayUrl(),
      },
    });
    const runtime = new PiRuntime(client);
    const unsubscribeConversation = runtime.onConversationEvent((event) =>
      this.handleEvent(event),
    );
    const unsubscribeRuntime = runtime.onRuntimeEvent((event) => {
      if (event.type === "agent_settled") {
        void Promise.all([
          this.syncTaskSession(),
          this.flushConversationLog(),
        ]).catch((error) =>
          this.logger.error("Failed to persist settled Pi turn", error),
        );
      }
    });
    await client.start();
    const runtimeState = await client.getState();
    this.sessionFile = runtimeState.sessionFile ?? restoredSessionFile ?? null;
    const unsubscribe = () => {
      unsubscribeConversation();
      unsubscribeRuntime();
    };

    this.session = { payload, runtime, sseController: null, unsubscribe };
    await this.syncTaskSession();
    this.sessionSyncInterval = setInterval(() => {
      void this.syncTaskSession().catch((error) =>
        this.logger.error("Failed to sync active Pi session", error),
      );
    }, SESSION_SYNC_INTERVAL_MS);
    this.sessionReadyBootMs = Math.round(process.uptime() * 1000);
    this.sessionInitMs = Date.now() - startedAt;
    await this.posthogAPI.updateTaskRun(payload.task_id, payload.run_id, {
      status: "in_progress",
    });
    this.broadcast({
      type: "pi_run_started",
      timestamp: new Date().toISOString(),
      taskId: payload.task_id,
      runId: payload.run_id,
    });

    const pendingMessage =
      typeof state.pending_user_message === "string"
        ? state.pending_user_message
        : null;
    const prompt = pendingMessage?.trim() || task.description?.trim();
    const prewarmed = state.prewarmed === true;
    if (prompt && (!prewarmed || pendingMessage)) {
      await client.prompt(prompt);
    }
  }

  private handleEvent(event: AgentConversationEvent): void {
    this.broadcast({
      type: "pi_event",
      timestamp: new Date().toISOString(),
      event,
    });
  }

  private async executeCommand(
    method: PiCommandMethod,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const runtime = this.session?.runtime;
    if (!runtime) {
      throw new Error("No active Pi runtime");
    }
    const client = runtime.client;
    switch (method) {
      case "user_message":
        return this.deliverUserMessage(client, params);
      case "cancel":
        return client.abort();
      case "pi/rpc":
        return sendPiRpcCommand(client, params.command as RpcCommand);
    }
  }

  private async deliverUserMessage(
    client: PiRpcClient,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const messageId =
      typeof params.messageId === "string" ? params.messageId : null;
    if (!messageId) {
      return this.dispatchUserMessage(client, String(params.content));
    }

    if (this.completedUserMessageDeliveries.has(messageId)) {
      return this.completedUserMessageDeliveries.get(messageId);
    }

    const existingDelivery = this.userMessageDeliveries.get(messageId);
    if (existingDelivery) {
      return existingDelivery;
    }

    const delivery = this.dispatchUserMessage(client, String(params.content));
    this.userMessageDeliveries.set(messageId, delivery);
    try {
      const result = await delivery;
      if (this.userMessageDeliveries.get(messageId) === delivery) {
        this.userMessageDeliveries.delete(messageId);
        this.completedUserMessageDeliveries.set(messageId, result);
        this.evictCompletedUserMessageDeliveries();
      }
      return result;
    } catch (error) {
      if (this.userMessageDeliveries.get(messageId) === delivery) {
        this.userMessageDeliveries.delete(messageId);
      }
      throw error;
    }
  }

  private async dispatchUserMessage(
    client: PiRpcClient,
    content: string,
  ): Promise<unknown> {
    const state = await client.getState();
    if (state.isStreaming) {
      return client.followUp(content);
    }
    return client.prompt(content);
  }

  private evictCompletedUserMessageDeliveries(): void {
    while (
      this.completedUserMessageDeliveries.size >
      COMPLETED_USER_MESSAGE_DELIVERY_LIMIT
    ) {
      const oldestMessageId = this.completedUserMessageDeliveries
        .keys()
        .next().value;
      if (oldestMessageId === undefined) {
        return;
      }
      this.completedUserMessageDeliveries.delete(oldestMessageId);
    }
  }

  private installSseController(sseController: SseController | null): void {
    if (sseController && !this.canceledSseControllers.has(sseController)) {
      if (this.session) {
        this.session.sseController = sseController;
      }
    }
  }

  private cancelSseController(sseController: SseController | null): void {
    if (!sseController) {
      return;
    }
    this.canceledSseControllers.add(sseController);
    if (this.session?.sseController === sseController) {
      this.session.sseController = null;
    }
  }

  private syncTaskSession(): Promise<void> {
    const sync = this.sessionSyncQueue.then(async () => {
      if (!this.sessionFile) {
        return;
      }

      let content: string;
      try {
        content = await readFile(this.sessionFile, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return;
        }
        throw error;
      }
      if (content === this.lastSyncedSessionContent) {
        return;
      }

      if (!this.config.sandboxId) {
        throw new Error("Pi task session persistence requires a sandbox ID");
      }
      this.sessionRevision = await this.posthogAPI.syncTaskSession(
        this.config.taskId,
        this.config.runId,
        this.config.sandboxId,
        this.sessionRevision,
        content,
      );
      this.lastSyncedSessionContent = content;
    });
    this.sessionSyncQueue = sync.catch(() => undefined);
    return sync;
  }

  private broadcast(event: Record<string, unknown>): void {
    if (event.type === "pi_event" || event.type === "pi_run_started") {
      this.pendingLogEntries.push({
        type: event.type,
        timestamp:
          typeof event.timestamp === "string" ? event.timestamp : undefined,
        event:
          event.type === "pi_event"
            ? (event.event as AgentConversationEvent)
            : undefined,
      });
      if (
        event.type === "pi_run_started" ||
        (event.event as { type?: string } | undefined)?.type ===
          "turn_completed"
      ) {
        void this.flushConversationLog().catch((error) =>
          this.logger.error("Failed to persist Pi conversation events", error),
        );
      }
    }

    this.eventStreamSender?.enqueue(event);
    if (this.session?.sseController) {
      this.session.sseController.send(event);
    } else {
      this.pendingEvents.push(event);
    }
  }

  private flushConversationLog(): Promise<void> {
    if (this.pendingLogEntries.length === 0) {
      return this.logFlushQueue;
    }

    const entries = this.pendingLogEntries;
    this.pendingLogEntries = [];
    const flush = this.logFlushQueue
      .then(() =>
        this.posthogAPI.appendTaskRunLog(
          this.config.taskId,
          this.config.runId,
          entries,
        ),
      )
      .then(() => undefined)
      .catch((error) => {
        this.pendingLogEntries = [...entries, ...this.pendingLogEntries];
        throw error;
      });
    this.logFlushQueue = flush.catch(() => undefined);
    return flush;
  }

  private replayPendingEvents(): void {
    const controller = this.session?.sseController;
    if (!controller) {
      return;
    }
    const events = this.pendingEvents;
    this.pendingEvents = [];
    for (const event of events) {
      controller.send(event);
    }
  }

  private authenticate(
    getHeader: (name: string) => string | undefined,
  ): JwtPayload {
    const authHeader = getHeader("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new JwtValidationError(
        "Missing authorization header",
        "invalid_token",
      );
    }
    return validateJwt(authHeader.slice(7), this.config.jwtPublicKey);
  }

  private async waitForRepoReady(): Promise<void> {
    const path = this.config.repoReadyFile;
    if (!path) {
      return;
    }
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      try {
        await access(path);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw new Error(`Repository readiness file was not created: ${path}`);
  }
}
