import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  ContentBlock,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";
import { type ServerType, serve } from "@hono/node-server";
import { execGh } from "@posthog/git/gh";
import { getCurrentBranch } from "@posthog/git/queries";
import { Hono } from "hono";
import { z } from "zod";
import packageJson from "../../package.json" with { type: "json" };
import { POSTHOG_METHODS, POSTHOG_NOTIFICATIONS } from "../acp-extensions";
import {
  createAcpConnection,
  type InProcessAcpConnection,
} from "../adapters/acp-connection";
import type { GatewayEnv } from "../adapters/claude/session/options";
import {
  type AgentErrorClassification,
  classifyAgentError,
} from "../adapters/error-classification";
import {
  SIGNED_COMMIT_QUALIFIED_TOOL_NAME,
  SIGNED_MERGE_QUALIFIED_TOOL_NAME,
  SIGNED_REWRITE_QUALIFIED_TOOL_NAME,
} from "../adapters/signed-commit-shared";
import type { PermissionMode } from "../execution-mode";
import { DEFAULT_CODEX_MODEL } from "../gateway-models";
import { HandoffCheckpointTracker } from "../handoff-checkpoint";
import { PostHogAPIClient } from "../posthog-api";
import { findPrUrl, wasCreatedRecently } from "../pr-url-detector";
import {
  formatConversationForResume,
  type ResumeState,
  resumeFromLog,
} from "../resume";
import { SessionLogWriter } from "../session-log-writer";
import type {
  AgentMode,
  DeviceInfo,
  GitCheckpointEvent,
  HandoffLocalGitState,
  LogLevel,
  Task,
  TaskRun,
  TaskRunArtifact,
} from "../types";
import { resourceLink } from "../utils/acp-content";
import { AsyncMutex } from "../utils/async-mutex";
import {
  buildGatewayPropertyHeaders,
  resolveGatewayProduct,
  resolveLlmGatewayUrl,
} from "../utils/gateway";
import { Logger } from "../utils/logger";
import { logAgentshRuntimeInfo } from "./agentsh-runtime";
import {
  normalizeCloudPromptContent,
  promptBlocksToText,
} from "./cloud-prompt";
import { TaskRunEventStreamSender } from "./event-stream-sender";
import { type JwtPayload, JwtValidationError, validateJwt } from "./jwt";
import {
  handoffLocalGitStateSchema,
  jsonRpcRequestSchema,
  validateCommandParams,
} from "./schemas";
import type { AgentServerConfig } from "./types";

const agentErrorClassificationSchema = z.enum([
  "upstream_stream_terminated",
  "upstream_connection_error",
  "upstream_provider_failure",
  "agent_error",
]) satisfies z.ZodType<AgentErrorClassification>;

export const UPSTREAM_PROVIDER_FAILURE_MESSAGE =
  "The upstream AI provider failed to process the request. Please retry the task in a few minutes.";

const upstreamProviderFailureClassifications =
  new Set<AgentErrorClassification>([
    "upstream_stream_terminated",
    "upstream_connection_error",
    "upstream_provider_failure",
  ]);

const errorWithClassificationSchema = z.object({
  data: z.object({ classification: agentErrorClassificationSchema }),
});

type MessageCallback = (message: unknown) => void;

export const SSE_KEEPALIVE_INTERVAL_MS = 25_000;

class NdJsonTap {
  private decoder = new TextDecoder();
  private buffer = "";

  constructor(private onMessage: MessageCallback) {}

  process(chunk: Uint8Array): void {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        this.onMessage(JSON.parse(line));
      } catch {
        // Not valid JSON, skip
      }
    }
  }
}

function createTappedReadableStream(
  underlying: ReadableStream<Uint8Array>,
  onMessage: MessageCallback,
  logger?: Logger,
): ReadableStream<Uint8Array> {
  const reader = underlying.getReader();
  const tap = new NdJsonTap(onMessage);

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        tap.process(value);
        controller.enqueue(value);
      } catch (error) {
        logger?.debug("Read failed, closing stream", error);
        controller.close();
      }
    },
    cancel() {
      reader.releaseLock();
    },
  });
}

function createTappedWritableStream(
  underlying: WritableStream<Uint8Array>,
  onMessage: MessageCallback,
  logger?: Logger,
): WritableStream<Uint8Array> {
  const tap = new NdJsonTap(onMessage);
  const mutex = new AsyncMutex();

  return new WritableStream<Uint8Array>({
    async write(chunk) {
      tap.process(chunk);
      await mutex.acquire();
      try {
        const writer = underlying.getWriter();
        await writer.write(chunk);
        writer.releaseLock();
      } catch (error) {
        logger?.debug("Write failed (stream may be closed)", error);
      } finally {
        mutex.release();
      }
    },
    async close() {
      await mutex.acquire();
      try {
        const writer = underlying.getWriter();
        await writer.close();
        writer.releaseLock();
      } catch (error) {
        logger?.debug("Close failed (stream may be closed)", error);
      } finally {
        mutex.release();
      }
    },
    async abort(reason) {
      await mutex.acquire();
      try {
        const writer = underlying.getWriter();
        await writer.abort(reason);
        writer.releaseLock();
      } catch (error) {
        logger?.debug("Abort failed (stream may be closed)", error);
      } finally {
        mutex.release();
      }
    },
  });
}

export function isTurnCompleteNotification(message: unknown): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { method?: unknown }).method ===
      POSTHOG_NOTIFICATIONS.TURN_COMPLETE
  );
}

interface SseController {
  send: (data: unknown) => void;
  close: () => void;
}

interface ActiveSession {
  payload: JwtPayload;
  acpSessionId: string;
  acpConnection: InProcessAcpConnection;
  clientConnection: ClientSideConnection;
  sseController: SseController | null;
  deviceInfo: DeviceInfo;
  logWriter: SessionLogWriter;
  /** Current permission mode, tracked for relay decisions */
  permissionMode: PermissionMode;
  /** Whether a desktop client has ever connected via SSE during this session */
  hasDesktopConnected: boolean;
  pendingHandoffGitState?: HandoffLocalGitState;
}

function getTaskRunStateString(
  taskRun: TaskRun | null,
  key: string,
): string | null {
  const state = taskRun?.state;

  if (!state || typeof state !== "object") {
    return null;
  }

  const value = (state as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export class AgentServer {
  private config: AgentServerConfig;
  private logger: Logger;
  private server: ServerType | null = null;
  private session: ActiveSession | null = null;
  private app: Hono;
  private posthogAPI: PostHogAPIClient;
  private eventStreamSender: TaskRunEventStreamSender | null = null;
  private questionRelayedToSlack = false;
  private adapterEmittedTurnComplete = false;
  private detectedPrUrl: string | null = null;
  // Reset per session. `evaluatedPrUrls` dedupes the GitHub lookup per URL.
  private prAttributed = false;
  private readonly evaluatedPrUrls = new Set<string>();
  private lastReportedBranch: string | null = null;
  private resumeState: ResumeState | null = null;
  // Guards against concurrent session initialization. autoInitializeSession() and
  // the GET /events SSE handler can both call initializeSession() — the SSE connection
  // often arrives while newSession() is still awaited (this.session is still null),
  // causing a second session to be created and duplicate Slack messages to be sent.
  private initializationPromise: Promise<void> | null = null;
  private pendingEvents: Record<string, unknown>[] = [];
  private pendingPermissions = new Map<
    string,
    {
      resolve: (response: {
        outcome: { outcome: "selected"; optionId: string };
        _meta?: Record<string, unknown>;
      }) => void;
      toolCallId?: string;
    }
  >();

  private detachSseController(controller: SseController): void {
    if (this.session?.sseController === controller) {
      this.session.sseController = null;
    }
  }

  private emitConsoleLog = (
    level: LogLevel,
    _scope: string,
    message: string,
    data?: unknown,
  ): void => {
    if (!this.session) return;

    const formatted =
      data !== undefined ? `${message} ${JSON.stringify(data)}` : message;

    const notification = {
      jsonrpc: "2.0",
      method: POSTHOG_NOTIFICATIONS.CONSOLE,
      params: { level, message: formatted },
    };

    this.broadcastEvent({
      type: "notification",
      timestamp: new Date().toISOString(),
      notification,
    });

    this.session.logWriter.appendRawLine(
      this.session.payload.run_id,
      JSON.stringify(notification),
    );
  };

  constructor(config: AgentServerConfig) {
    this.config = config;
    this.logger = new Logger({ debug: true, prefix: "[AgentServer]" });
    this.posthogAPI = new PostHogAPIClient({
      apiUrl: config.apiUrl,
      projectId: config.projectId,
      getApiKey: () => config.apiKey,
      userAgent: `posthog/cloud.hog.dev; version: ${config.version ?? packageJson.version}`,
    });
    if (config.eventIngestToken) {
      this.eventStreamSender = new TaskRunEventStreamSender({
        apiUrl: config.apiUrl,
        projectId: config.projectId,
        taskId: config.taskId,
        runId: config.runId,
        token: config.eventIngestToken,
        logger: this.logger.child("EventIngest"),
        streamWindowMs: config.eventIngestStreamWindowMs,
      });
    }
    this.app = this.createApp();
  }

  private getRuntimeAdapter(): "claude" | "codex" {
    return this.config.runtimeAdapter ?? "claude";
  }

  private getEffectiveMode(payload: JwtPayload): AgentMode {
    return payload.mode ?? this.config.mode;
  }

  private getSessionPermissionMode(): PermissionMode {
    if (this.session?.permissionMode) {
      return this.session.permissionMode;
    }

    return this.getRuntimeAdapter() === "codex" ? "auto" : "default";
  }

  private shouldRelayPermissionToClient(mode: PermissionMode): boolean {
    return mode === "default" || mode === "auto" || mode === "read-only";
  }

  private createApp(): Hono {
    const app = new Hono();

    app.get("/health", (c) => {
      return c.json({ status: "ok", hasSession: !!this.session });
    });

    app.get("/events", async (c) => {
      let payload: JwtPayload;

      try {
        payload = this.authenticateRequest(c.req.header.bind(c.req));
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof JwtValidationError
                ? error.message
                : "Invalid token",
            code:
              error instanceof JwtValidationError
                ? error.code
                : "invalid_token",
          },
          401,
        );
      }

      let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
      const clearKeepalive = (): void => {
        if (keepaliveInterval) {
          clearInterval(keepaliveInterval);
          keepaliveInterval = null;
        }
      };

      const stream = new ReadableStream({
        start: async (controller) => {
          let sseController: SseController | null = null;
          const encoder = new TextEncoder();
          const detachCurrentSseController = (): void => {
            if (sseController) {
              this.detachSseController(sseController);
            }
          };
          const enqueueSseFrame = (frame: string): void => {
            try {
              controller.enqueue(encoder.encode(frame));
            } catch {
              clearKeepalive();
              detachCurrentSseController();
            }
          };

          sseController = {
            send: (data: unknown) => {
              enqueueSseFrame(`data: ${JSON.stringify(data)}\n\n`);
            },
            close: () => {
              try {
                clearKeepalive();
                controller.close();
              } catch {
                detachCurrentSseController();
              }
            },
          };

          keepaliveInterval = setInterval(() => {
            enqueueSseFrame(": keepalive\n\n");
          }, SSE_KEEPALIVE_INTERVAL_MS);

          try {
            if (
              !this.session ||
              this.session.payload.run_id !== payload.run_id
            ) {
              await this.initializeSession(payload, sseController);
            } else {
              this.session.sseController = sseController;
              this.session.hasDesktopConnected = true;
              this.replayPendingEvents();
            }

            this.sendSseEvent(sseController, {
              type: "connected",
              run_id: payload.run_id,
            });
          } catch (error) {
            clearKeepalive();
            throw error;
          }
        },
        cancel: () => {
          clearKeepalive();
          this.logger.debug("SSE connection closed");
          if (this.session?.sseController) {
            this.session.sseController = null;
          }
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

    app.post("/command", async (c) => {
      let payload: JwtPayload;

      try {
        payload = this.authenticateRequest(c.req.header.bind(c.req));
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof JwtValidationError
                ? error.message
                : "Invalid token",
          },
          401,
        );
      }

      if (!this.session || this.session.payload.run_id !== payload.run_id) {
        return c.json({ error: "No active session for this run" }, 400);
      }

      const rawBody = await c.req.json().catch(() => null);
      const parseResult = jsonRpcRequestSchema.safeParse(rawBody);

      if (!parseResult.success) {
        return c.json({ error: "Invalid JSON-RPC request" }, 400);
      }

      const command = parseResult.data;
      const paramsValidation = validateCommandParams(
        command.method,
        command.params ?? {},
      );

      if (!paramsValidation.success) {
        return c.json(
          {
            jsonrpc: "2.0",
            id: command.id,
            error: {
              code: -32602,
              message: paramsValidation.error,
            },
          },
          200,
        );
      }

      try {
        const result = await this.executeCommand(
          command.method,
          (command.params as Record<string, unknown>) || {},
        );
        return c.json({
          jsonrpc: "2.0",
          id: command.id,
          result,
        });
      } catch (error) {
        return c.json({
          jsonrpc: "2.0",
          id: command.id,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : "Unknown error",
          },
        });
      }
    });

    app.notFound((c) => {
      return c.json({ error: "Not found" }, 404);
    });

    return app;
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server = serve(
        {
          fetch: this.app.fetch,
          port: this.config.port,
        },
        () => {
          this.logger.debug(
            `HTTP server listening on port ${this.config.port}`,
          );
          resolve();
        },
      );
    });

    await this.autoInitializeSession();
  }

  private async loadResumeState(
    taskId: string,
    resumeRunId: string,
    currentRunId: string,
  ): Promise<void> {
    this.logger.debug("Loading resume state", { resumeRunId, currentRunId });
    try {
      this.resumeState = await resumeFromLog({
        taskId,
        runId: resumeRunId,
        repositoryPath: this.config.repositoryPath,
        apiClient: this.posthogAPI,
        logger: new Logger({ debug: true, prefix: "[Resume]" }),
      });
      this.logger.debug("Resume state loaded", {
        conversationTurns: this.resumeState.conversation.length,
        hasGitCheckpoint: !!this.resumeState.latestGitCheckpoint,
        gitCheckpointBranch:
          this.resumeState.latestGitCheckpoint?.branch ?? null,
        logEntries: this.resumeState.logEntryCount,
      });
    } catch (error) {
      this.logger.debug("Failed to load resume state, starting fresh", {
        error,
      });
      this.resumeState = null;
    }
  }

  async stop(): Promise<void> {
    this.logger.debug("Stopping agent server...");

    if (this.session) {
      await this.cleanupSession({ completeEventStream: true });
    } else {
      await this.eventStreamSender?.stop();
    }

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    this.logger.debug("Agent server stopped");
  }

  /**
   * Mark the run failed after an unrecoverable crash (uncaught exception /
   * unhandled rejection). Without this a hard death is silent: the run row
   * stays non-terminal, the desktop client just sees the stream stop and shows
   * a generic "Cloud stream disconnected", and the workflow only gives up after
   * the multi-hour inactivity timeout. Best-effort and self-contained so it can
   * run from a process-level handler with no session context.
   */
  async reportFatalError(error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.error("Fatal agent-server error; marking run failed", error);

    try {
      await this.posthogAPI.updateTaskRun(
        this.config.taskId,
        this.config.runId,
        {
          status: "failed",
          error_message: `Agent server crashed: ${errorMessage}`,
        },
      );
    } catch (updateError) {
      this.logger.error(
        "Failed to mark run failed after fatal error",
        updateError,
      );
    }

    try {
      await this.eventStreamSender?.stop();
    } catch (stopError) {
      this.logger.error(
        "Failed to flush event stream after fatal error",
        stopError,
      );
    }
  }

  private authenticateRequest(
    getHeader: (name: string) => string | undefined,
  ): JwtPayload {
    // Always require JWT validation - never trust unverified headers
    if (!this.config.jwtPublicKey) {
      throw new JwtValidationError(
        "Server not configured with JWT public key",
        "server_error",
      );
    }

    const authHeader = getHeader("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new JwtValidationError(
        "Missing authorization header",
        "invalid_token",
      );
    }

    const token = authHeader.slice(7);
    return validateJwt(token, this.config.jwtPublicKey);
  }

  private async executeCommand(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.session) {
      throw new Error("No active session");
    }

    switch (method) {
      case POSTHOG_NOTIFICATIONS.USER_MESSAGE:
      case "user_message": {
        this.logger.debug("Received user_message command", {
          hasContent:
            typeof params.content === "string"
              ? params.content.trim().length > 0
              : Array.isArray(params.content) && params.content.length > 0,
          artifactCount: Array.isArray(params.artifacts)
            ? params.artifacts.length
            : 0,
        });
        const prompt = await this.buildPromptFromContentAndArtifacts({
          content: params.content as string | ContentBlock[] | undefined,
          artifacts: Array.isArray(params.artifacts)
            ? (params.artifacts as TaskRunArtifact[])
            : [],
          taskId: this.session.payload.task_id,
          runId: this.session.payload.run_id,
        });
        if (prompt.length === 0) {
          throw new Error("User message cannot be empty");
        }
        this.logger.debug("Built user_message prompt", {
          blockTypes: prompt.map((block) => block.type),
        });
        const promptPreview = promptBlocksToText(prompt);

        this.logger.debug(
          `Processing user message (detectedPrUrl=${this.detectedPrUrl ?? "none"}): ${promptPreview.substring(0, 100)}...`,
        );

        this.session.logWriter.resetTurnMessages(this.session.payload.run_id);

        const result = await this.session.clientConnection.prompt({
          sessionId: this.session.acpSessionId,
          prompt,
          ...(this.detectedPrUrl && {
            _meta: {
              // Keep the live-session PR override aligned with the startup
              // prompt policy so non-Slack runs remain review-first.
              prContext: this.buildDetectedPrContext(this.detectedPrUrl),
            },
          }),
        });

        this.logger.debug("User message completed", {
          stopReason: result.stopReason,
        });

        if (result.stopReason === "end_turn") {
          void this.syncCloudBranchMetadata(this.session.payload);
        }

        this.broadcastTurnComplete(result.stopReason);

        if (result.stopReason === "end_turn") {
          // Relay the response to Slack. For follow-ups this is the primary
          // delivery path — the HTTP caller only handles reactions.
          this.relayAgentResponse(this.session.payload).catch((err) =>
            this.logger.debug("Failed to relay follow-up response", err),
          );
        }

        // Flush logs and include the assistant's response text so callers
        // (e.g. Slack follow-up forwarding) can extract it without racing
        // against async log persistence to object storage.
        let assistantMessage: string | undefined;
        try {
          await this.session.logWriter.flush(this.session.payload.run_id, {
            coalesce: true,
          });
          assistantMessage = this.session.logWriter.getFullAgentResponse(
            this.session.payload.run_id,
          );
        } catch {
          this.logger.debug("Failed to extract assistant message from logs");
        }

        return {
          stopReason: result.stopReason,
          ...(assistantMessage && { assistant_message: assistantMessage }),
        };
      }

      case POSTHOG_NOTIFICATIONS.CANCEL:
      case "cancel": {
        this.logger.debug("Cancel requested", {
          acpSessionId: this.session.acpSessionId,
        });
        await this.session.clientConnection.cancel({
          sessionId: this.session.acpSessionId,
        });
        return { cancelled: true };
      }

      case POSTHOG_NOTIFICATIONS.CLOSE:
      case "close": {
        this.logger.debug("Close requested");
        const localGitState = this.extractHandoffLocalGitState(params);
        if (localGitState && this.session) {
          this.session.pendingHandoffGitState = localGitState;
        }
        await this.cleanupSession();
        return { closed: true };
      }

      case "posthog/set_config_option":
      case "set_config_option": {
        const configId = params.configId as string;
        const value = params.value as string;

        this.logger.debug("Set config option requested", { configId, value });

        const result =
          await this.session.clientConnection.setSessionConfigOption({
            sessionId: this.session.acpSessionId,
            configId,
            value,
          });

        return {
          configOptions: result.configOptions,
        };
      }

      case POSTHOG_METHODS.REFRESH_SESSION:
      case "posthog/refresh_session":
      case "refresh_session": {
        const mcpServers = Array.isArray(params.mcpServers)
          ? params.mcpServers
          : [];
        const refreshedCredentials = Array.isArray(params.refreshedCredentials)
          ? (params.refreshedCredentials as string[])
          : [];
        const authorship =
          typeof params.authorship === "string" ? params.authorship : "";

        if (refreshedCredentials.length > 0) {
          const owner = authorship ? ` (${authorship})` : "";
          this.logger.debug(
            `Refreshed sandbox credentials${owner}: ${refreshedCredentials.join(", ")}`,
          );
        }

        if (mcpServers.length === 0) {
          return { refreshed: true };
        }

        this.logger.debug("Refresh session requested", {
          serverCount: mcpServers.length,
        });

        return await this.session.clientConnection.extMethod(
          POSTHOG_METHODS.REFRESH_SESSION,
          { mcpServers },
        );
      }

      case POSTHOG_NOTIFICATIONS.PERMISSION_RESPONSE:
      case "permission_response": {
        const requestId = params.requestId as string;
        const optionId = params.optionId as string;
        const customInput = params.customInput as string | undefined;
        const answers = params.answers as Record<string, string> | undefined;

        this.logger.debug("Permission response received", {
          requestId,
          optionId,
        });

        const resolved = this.resolvePermission(
          requestId,
          optionId,
          customInput,
          answers,
        );
        if (!resolved) {
          throw new Error(
            `No pending permission request found for id: ${requestId}`,
          );
        }
        return { resolved: true };
      }

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  private async initializeSession(
    payload: JwtPayload,
    sseController: SseController | null,
  ): Promise<void> {
    // Race condition guard: autoInitializeSession() starts first, but while it awaits
    // newSession() (which takes ~1-2s for MCP metadata fetch), the Temporal relay connects
    // to GET /events. That handler sees this.session === null and calls initializeSession()
    // again, creating a duplicate session that sends the same prompt twice — resulting in
    // duplicate Slack messages. This lock ensures the second caller waits for the first
    // initialization to finish and reuses the session.
    if (this.initializationPromise) {
      this.logger.debug("Waiting for in-progress initialization", {
        runId: payload.run_id,
      });
      await this.initializationPromise;
      // After waiting, just attach the SSE controller if needed
      if (this.session && sseController) {
        this.session.sseController = sseController;
        this.session.hasDesktopConnected = true;
        this.replayPendingEvents();
      }
      return;
    }

    this.initializationPromise = this._doInitializeSession(
      payload,
      sseController,
    );
    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  private async _doInitializeSession(
    payload: JwtPayload,
    sseController: SseController | null,
  ): Promise<void> {
    if (this.session) {
      await this.cleanupSession();
    }

    this.logger.debug("Initializing session", {
      runId: payload.run_id,
      taskId: payload.task_id,
    });

    const deviceInfo: DeviceInfo = {
      type: "cloud",
      name: process.env.HOSTNAME || "cloud-sandbox",
    };

    const [preTaskRun, preTask] = await Promise.all([
      this.posthogAPI
        .getTaskRun(payload.task_id, payload.run_id)
        .catch((err) => {
          this.logger.debug("Failed to fetch task run for session context", {
            taskId: payload.task_id,
            runId: payload.run_id,
            error: err,
          });
          return null;
        }),
      this.posthogAPI.getTask(payload.task_id).catch((err) => {
        this.logger.debug("Failed to fetch task for session context", {
          taskId: payload.task_id,
          error: err,
        });
        return null;
      }),
    ]);

    const gatewayEnv = this.configureEnvironment({
      isInternal: preTask?.internal === true,
      originProduct: preTask?.origin_product,
      signalReportId: preTask?.signal_report,
      aiStage: getTaskRunStateString(preTaskRun, "ai_stage"),
      taskId: payload.task_id,
      taskRunId: payload.run_id,
      taskUserId: payload.user_id,
      taskTitle: preTask?.title,
    });

    const prUrl = getTaskRunStateString(preTaskRun, "slack_notified_pr_url");

    // Unconditional so a re-init on the same instance drops a stale PR URL.
    this.detectedPrUrl = prUrl;

    const slackThreadUrl = getTaskRunStateString(
      preTaskRun,
      "slack_thread_url",
    );

    const runtimeAdapter = this.getRuntimeAdapter();
    const sessionSystemPrompt = this.buildSessionSystemPrompt(
      prUrl,
      slackThreadUrl,
    );
    const codexInstructions =
      runtimeAdapter === "codex"
        ? this.buildCodexInstructions(sessionSystemPrompt)
        : undefined;

    const posthogAPI = new PostHogAPIClient({
      apiUrl: this.config.apiUrl,
      projectId: this.config.projectId,
      getApiKey: () => this.config.apiKey,
      userAgent: `posthog/cloud.hog.dev; version: ${this.config.version ?? packageJson.version}`,
    });

    const logWriter = new SessionLogWriter({
      posthogAPI,
      logger: new Logger({ debug: true, prefix: "[SessionLogWriter]" }),
    });

    const acpConnection = createAcpConnection({
      adapter: runtimeAdapter,
      taskRunId: payload.run_id,
      taskId: payload.task_id,
      deviceType: deviceInfo.type,
      logWriter,
      logger: this.logger,
      claudeGatewayEnv: runtimeAdapter !== "codex" ? gatewayEnv : undefined,
      codexOptions:
        runtimeAdapter === "codex"
          ? {
              cwd: this.config.repositoryPath ?? "/tmp/workspace",
              apiBaseUrl: gatewayEnv.openaiBaseUrl,
              apiKey: this.config.apiKey,
              model: this.config.model ?? DEFAULT_CODEX_MODEL,
              reasoningEffort: this.config.reasoningEffort,
              developerInstructions: codexInstructions,
            }
          : undefined,
      onStructuredOutput: async (output) => {
        await this.posthogAPI.setTaskRunOutput(
          payload.task_id,
          payload.run_id,
          {
            output,
          },
        );
      },
    });

    // Tap both streams to broadcast all ACP messages via SSE (mimics local transport)
    this.adapterEmittedTurnComplete = false;
    const onAcpMessage = (message: unknown) => {
      if (isTurnCompleteNotification(message)) {
        this.adapterEmittedTurnComplete = true;
      }
      this.broadcastEvent({
        type: "notification",
        timestamp: new Date().toISOString(),
        notification: message,
      });
    };

    const tappedReadable = createTappedReadableStream(
      acpConnection.clientStreams.readable as ReadableStream<Uint8Array>,
      onAcpMessage,
      this.logger,
    );

    const tappedWritable = createTappedWritableStream(
      acpConnection.clientStreams.writable as WritableStream<Uint8Array>,
      onAcpMessage,
      this.logger,
    );

    const clientStream = ndJsonStream(tappedWritable, tappedReadable);

    const clientConnection = new ClientSideConnection(
      () => this.createCloudClient(payload),
      clientStream,
    );

    await clientConnection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    });

    const runState = preTaskRun?.state as Record<string, unknown> | undefined;
    // Preserve native Codex modes for cloud runs so they behave the same as
    // local sessions. Claude keeps the historical auto-approved default when
    // PostHog Code has not explicitly selected a mode.
    const initialPermissionMode: PermissionMode =
      typeof runState?.initial_permission_mode === "string"
        ? (runState.initial_permission_mode as PermissionMode)
        : runtimeAdapter === "codex"
          ? "auto"
          : "bypassPermissions";
    const sessionResponse = await clientConnection.newSession({
      cwd: this.config.repositoryPath ?? "/tmp/workspace",
      mcpServers: this.config.mcpServers ?? [],
      _meta: {
        sessionId: payload.run_id,
        taskRunId: payload.run_id,
        taskId: payload.task_id,
        environment: "cloud",
        systemPrompt: sessionSystemPrompt,
        ...(this.config.model && { model: this.config.model }),
        allowedDomains: this.config.allowedDomains,
        jsonSchema: preTask?.json_schema ?? null,
        permissionMode: initialPermissionMode,
        ...(this.config.baseBranch && { baseBranch: this.config.baseBranch }),
        ...this.buildClaudeCodeSessionMeta(runtimeAdapter),
      },
    });

    const acpSessionId = sessionResponse.sessionId;
    this.logger.debug("ACP session created", {
      acpSessionId,
      runId: payload.run_id,
    });

    this.prAttributed = false;
    this.evaluatedPrUrls.clear();

    this.session = {
      payload,
      acpSessionId,
      acpConnection,
      clientConnection,
      sseController,
      deviceInfo,
      logWriter,
      permissionMode: initialPermissionMode,
      hasDesktopConnected: sseController !== null,
      pendingHandoffGitState: undefined,
    };

    this.logger = new Logger({
      debug: true,
      prefix: "[AgentServer]",
      onLog: (level, scope, message, data) => {
        this.emitConsoleLog(level, scope, message, data);
      },
    });

    this.logger.debug("Session initialized successfully");
    this.logger.debug(
      `Agent version: ${this.config.version ?? packageJson.version}`,
    );
    await logAgentshRuntimeInfo(this.logger);
    this.logger.debug(`Initial permission mode: ${initialPermissionMode}`);

    // Lifecycle handshake: clients gate "agent is ready to accept user
    // messages" on this notification. Persisted to the session log so
    // warm reconnects (sandbox restart with snapshot resume) replay it
    // and see the agent come online again.
    const runStartedNotification = {
      jsonrpc: "2.0" as const,
      method: POSTHOG_NOTIFICATIONS.RUN_STARTED,
      params: {
        sessionId: acpSessionId,
        runId: payload.run_id,
        taskId: payload.task_id,
        agentVersion: this.config.version ?? packageJson.version,
      },
    };
    this.broadcastEvent({
      type: "notification",
      timestamp: new Date().toISOString(),
      notification: runStartedNotification,
    });
    this.session.logWriter.appendRawLine(
      payload.run_id,
      JSON.stringify(runStartedNotification),
    );

    // Signal in_progress so the UI can start polling for updates
    this.posthogAPI
      .updateTaskRun(payload.task_id, payload.run_id, {
        status: "in_progress",
      })
      .catch((err) =>
        this.logger.debug("Failed to set task run to in_progress", err),
      );

    await this.sendInitialTaskMessage(payload, preTaskRun);
  }

  private extractErrorClassification(error: unknown): {
    classification: AgentErrorClassification;
    message: string;
  } {
    const message =
      error instanceof Error ? error.message : String(error ?? "");

    // Prefer the structured `data` carried on RequestError if present.
    const parsed = errorWithClassificationSchema.safeParse(error);
    if (parsed.success) {
      return { classification: parsed.data.data.classification, message };
    }

    return { classification: classifyAgentError(message), message };
  }

  private classifyAndSignalFailure(
    payload: JwtPayload,
    phase: "initial" | "resume",
    error: unknown,
  ): Promise<void> {
    const { classification, message } = this.extractErrorClassification(error);
    const errorMessage = upstreamProviderFailureClassifications.has(
      classification,
    )
      ? UPSTREAM_PROVIDER_FAILURE_MESSAGE
      : message || "Agent error";
    this.logger.error(`send_${phase}_task_message_failed`, {
      classification,
      message,
    });
    return this.signalTaskComplete(payload, "error", errorMessage);
  }

  private async sendInitialTaskMessage(
    payload: JwtPayload,
    prefetchedRun?: TaskRun | null,
  ): Promise<void> {
    if (!this.session) return;

    // Fetch TaskRun early — needed for both resume detection and initial prompt
    let taskRun = prefetchedRun ?? null;
    if (!taskRun) {
      try {
        taskRun = await this.posthogAPI.getTaskRun(
          payload.task_id,
          payload.run_id,
        );
      } catch (error) {
        this.logger.debug("Failed to fetch task run", {
          taskId: payload.task_id,
          runId: payload.run_id,
          error,
        });
      }
    }

    if (!this.resumeState) {
      const resumeRunId = this.getResumeRunId(taskRun);
      if (resumeRunId) {
        await this.loadResumeState(
          payload.task_id,
          resumeRunId,
          payload.run_id,
        );
      }
    }

    // Resume flow: if we have resume state, format conversation history as context
    if (this.resumeState && this.resumeState.conversation.length > 0) {
      await this.sendResumeMessage(payload, taskRun);
      return;
    }

    try {
      const task = await this.posthogAPI.getTask(payload.task_id);

      const initialPromptOverride = taskRun
        ? this.getInitialPromptOverride(taskRun)
        : null;
      const pendingUserPrompt = await this.getPendingUserPrompt(taskRun);
      let initialPrompt: ContentBlock[] = [];
      if (pendingUserPrompt?.length) {
        initialPrompt = pendingUserPrompt;
      } else if (initialPromptOverride) {
        initialPrompt = [{ type: "text", text: initialPromptOverride }];
      } else if (task.description) {
        initialPrompt = [{ type: "text", text: task.description }];
      }

      if (initialPrompt.length === 0) {
        this.logger.debug("Task has no description, skipping initial message");
        return;
      }

      this.logger.debug("Sending initial task message", {
        taskId: payload.task_id,
        descriptionLength: promptBlocksToText(initialPrompt).length,
        usedInitialPromptOverride: !!initialPromptOverride,
        usedPendingUserMessage: !!pendingUserPrompt?.length,
      });

      this.session.logWriter.resetTurnMessages(payload.run_id);

      const result = await this.session.clientConnection.prompt({
        sessionId: this.session.acpSessionId,
        prompt: initialPrompt,
      });

      this.logger.debug("Initial task message completed", {
        stopReason: result.stopReason,
      });

      await this.clearPendingInitialPromptState(payload, taskRun);

      if (result.stopReason === "end_turn") {
        void this.syncCloudBranchMetadata(payload);
      }

      this.broadcastTurnComplete(result.stopReason);

      if (result.stopReason === "end_turn") {
        await this.relayAgentResponse(payload);
      }
    } catch (error) {
      this.logger.error("Failed to send initial task message", error);
      if (this.session) {
        await this.session.logWriter.flushAll();
      }
      await this.classifyAndSignalFailure(payload, "initial", error);
    }
  }

  private async sendResumeMessage(
    payload: JwtPayload,
    taskRun: TaskRun | null,
  ): Promise<void> {
    if (!this.session || !this.resumeState) return;

    try {
      const conversationSummary = formatConversationForResume(
        this.resumeState.conversation,
      );

      let checkpointApplied = false;
      if (
        this.resumeState.latestGitCheckpoint &&
        this.config.repositoryPath &&
        this.posthogAPI
      ) {
        try {
          const checkpointTracker = new HandoffCheckpointTracker({
            repositoryPath: this.config.repositoryPath,
            taskId: payload.task_id,
            runId: payload.run_id,
            apiClient: this.posthogAPI,
            logger: this.logger.child("HandoffCheckpoint"),
          });
          const metrics = await checkpointTracker.applyFromHandoff(
            this.resumeState.latestGitCheckpoint,
          );
          checkpointApplied = true;
          this.logger.debug("Git checkpoint applied", {
            branch: this.resumeState.latestGitCheckpoint.branch,
            head: this.resumeState.latestGitCheckpoint.head,
            packBytes: metrics.packBytes,
            indexBytes: metrics.indexBytes,
            totalBytes: metrics.totalBytes,
          });
        } catch (error) {
          this.logger.warn("Failed to apply git checkpoint", {
            error: error instanceof Error ? error.message : String(error),
            branch: this.resumeState.latestGitCheckpoint.branch,
          });
        }
      }

      const pendingUserPrompt = await this.getPendingUserPrompt(taskRun);

      const sandboxContext = checkpointApplied
        ? `The workspace environment (all files, packages, and code changes) has been fully restored from the latest checkpoint.`
        : `The workspace from the previous session was not restored from a checkpoint, so you are starting with a fresh environment. Your conversation history is fully preserved below.`;

      let resumePromptBlocks: ContentBlock[];
      if (pendingUserPrompt?.length) {
        resumePromptBlocks = [
          {
            type: "text",
            text:
              `You are resuming a previous conversation. ${sandboxContext}\n\n` +
              `Here is the conversation history from the previous session:\n\n` +
              `${conversationSummary}\n\n` +
              `The user has sent a new message:\n\n`,
          },
          ...pendingUserPrompt,
          {
            type: "text",
            text: "\n\nRespond to the user's new message above. You have full context from the previous session.",
          },
        ];
      } else {
        resumePromptBlocks = [
          {
            type: "text",
            text:
              `You are resuming a previous conversation. ${sandboxContext}\n\n` +
              `Here is the conversation history from the previous session:\n\n` +
              `${conversationSummary}\n\n` +
              `Continue from where you left off. The user is waiting for your response.`,
          },
        ];
      }

      this.logger.debug("Sending resume message", {
        taskId: payload.task_id,
        conversationTurns: this.resumeState.conversation.length,
        promptLength: promptBlocksToText(resumePromptBlocks).length,
        hasPendingUserMessage: !!pendingUserPrompt?.length,
        checkpointApplied,
        hasGitCheckpoint: !!this.resumeState.latestGitCheckpoint,
        gitCheckpointBranch:
          this.resumeState.latestGitCheckpoint?.branch ?? null,
      });

      // Clear resume state so it's not reused
      this.resumeState = null;

      this.session.logWriter.resetTurnMessages(payload.run_id);

      const result = await this.session.clientConnection.prompt({
        sessionId: this.session.acpSessionId,
        prompt: resumePromptBlocks,
      });

      this.logger.debug("Resume message completed", {
        stopReason: result.stopReason,
      });

      if (result.stopReason === "end_turn") {
        void this.syncCloudBranchMetadata(payload);
      }

      this.broadcastTurnComplete(result.stopReason);

      if (result.stopReason === "end_turn") {
        await this.relayAgentResponse(payload);
      }
    } catch (error) {
      this.logger.error("Failed to send resume message", error);
      if (this.session) {
        await this.session.logWriter.flushAll();
      }
      await this.classifyAndSignalFailure(payload, "resume", error);
    }
  }

  private getInitialPromptOverride(taskRun: TaskRun): string | null {
    const state = taskRun.state as Record<string, unknown> | undefined;
    const override = state?.initial_prompt_override;
    if (typeof override !== "string") {
      return null;
    }

    const trimmed = override.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async getPendingUserPrompt(
    taskRun: TaskRun | null,
  ): Promise<ContentBlock[] | null> {
    if (!taskRun) return null;
    const state = taskRun.state as Record<string, unknown> | undefined;
    const message = state?.pending_user_message;
    const artifactIds = Array.isArray(state?.pending_user_artifact_ids)
      ? state.pending_user_artifact_ids.filter(
          (artifactId): artifactId is string =>
            typeof artifactId === "string" && artifactId.trim().length > 0,
        )
      : [];
    const prompt = await this.buildPromptFromContentAndArtifacts({
      content: typeof message === "string" ? message : undefined,
      artifacts: this.getArtifactsById(taskRun.artifacts, artifactIds),
      taskId: taskRun.task,
      runId: taskRun.id,
    });
    this.logger.debug("Built pending user prompt", {
      hasMessage: typeof message === "string" && message.trim().length > 0,
      requestedArtifactCount: artifactIds.length,
      blockTypes: prompt.map((block) => block.type),
    });
    return prompt.length > 0 ? prompt : null;
  }

  private getClearedPendingUserState(taskRun: TaskRun | null): string[] | null {
    const state =
      taskRun?.state && typeof taskRun.state === "object"
        ? (taskRun.state as Record<string, unknown>)
        : null;
    if (!state) {
      return null;
    }

    const pendingKeys = [
      "pending_user_message",
      "pending_user_artifact_ids",
      "pending_user_message_ts",
    ].filter((key) => key in state);

    return pendingKeys.length > 0 ? pendingKeys : null;
  }

  private async clearPendingInitialPromptState(
    payload: JwtPayload,
    taskRun: TaskRun | null,
  ): Promise<void> {
    const stateRemoveKeys = this.getClearedPendingUserState(taskRun);
    if (!stateRemoveKeys) {
      return;
    }

    await this.posthogAPI.updateTaskRun(payload.task_id, payload.run_id, {
      state_remove_keys: stateRemoveKeys,
    });
  }

  private async buildPromptFromContentAndArtifacts({
    content,
    artifacts,
    taskId,
    runId,
  }: {
    content?: string | ContentBlock[];
    artifacts?: TaskRunArtifact[];
    taskId: string;
    runId: string;
  }): Promise<ContentBlock[]> {
    const contentBlocks = content ? normalizeCloudPromptContent(content) : [];
    const artifactBlocks = await this.hydrateArtifactsToPrompt(
      taskId,
      runId,
      artifacts ?? [],
    );

    return [...contentBlocks, ...artifactBlocks];
  }

  private getArtifactsById(
    artifacts: TaskRunArtifact[] | undefined,
    artifactIds: string[],
  ): TaskRunArtifact[] {
    if (!artifacts?.length || artifactIds.length === 0) {
      return [];
    }

    const artifactsById = new Map(
      artifacts
        .filter(
          (artifact): artifact is TaskRunArtifact & { id: string } =>
            typeof artifact.id === "string" && artifact.id.trim().length > 0,
        )
        .map((artifact) => [artifact.id, artifact]),
    );

    return artifactIds.flatMap((artifactId) => {
      const artifact = artifactsById.get(artifactId);
      if (!artifact) {
        this.logger.warn("Pending artifact missing from run manifest", {
          artifactId,
        });
        return [];
      }

      return [artifact];
    });
  }

  private async hydrateArtifactsToPrompt(
    taskId: string,
    runId: string,
    artifacts: TaskRunArtifact[],
  ): Promise<ContentBlock[]> {
    if (artifacts.length === 0) {
      return [];
    }

    this.logger.debug("Hydrating prompt artifacts", {
      taskId,
      runId,
      artifactCount: artifacts.length,
      artifactNames: artifacts.map((artifact) => artifact.name),
    });

    return (
      await Promise.all(
        artifacts.map((artifact) =>
          this.hydrateArtifactToPromptBlock(taskId, runId, artifact),
        ),
      )
    ).flatMap((artifactBlock) => (artifactBlock ? [artifactBlock] : []));
  }

  private async hydrateArtifactToPromptBlock(
    taskId: string,
    runId: string,
    artifact: TaskRunArtifact,
  ): Promise<ContentBlock | null> {
    if (!artifact.storage_path) {
      this.logger.warn("Skipping artifact without storage path", {
        taskId,
        runId,
        artifactName: artifact.name,
      });
      return null;
    }

    const data = await this.posthogAPI.downloadArtifact(
      taskId,
      runId,
      artifact.storage_path,
    );
    if (!data) {
      throw new Error(`Failed to download artifact ${artifact.name}`);
    }

    const safeName = this.getSafeArtifactName(artifact.name);
    const artifactDir = join(
      this.config.repositoryPath ?? "/tmp/workspace",
      ".posthog",
      "attachments",
      runId,
      artifact.id ?? safeName,
    );
    await mkdir(artifactDir, { recursive: true });

    const artifactPath = join(artifactDir, safeName);
    await writeFile(artifactPath, Buffer.from(data));

    return resourceLink(pathToFileURL(artifactPath).toString(), artifact.name, {
      ...(artifact.content_type ? { mimeType: artifact.content_type } : {}),
      ...(typeof artifact.size === "number" ? { size: artifact.size } : {}),
    });
  }

  private getSafeArtifactName(name: string): string {
    const baseName = basename(name).trim();
    const normalizedName = baseName.replace(/[^\w.-]/g, "_");
    return normalizedName.length > 0 ? normalizedName : "attachment";
  }

  private async autoInitializeSession(): Promise<void> {
    const { taskId, runId, mode, projectId } = this.config;

    this.logger.debug("Auto-initializing session", { taskId, runId, mode });

    const resumeRunId = process.env.POSTHOG_RESUME_RUN_ID;
    if (resumeRunId) {
      await this.loadResumeState(taskId, resumeRunId, runId);
    }

    // Create a synthetic payload from config (no JWT needed for auto-init)
    const payload: JwtPayload = {
      task_id: taskId,
      run_id: runId,
      team_id: projectId,
      user_id: 0, // System-initiated
      distinct_id: "agent-server",
      mode,
    };

    await this.initializeSession(payload, null);
  }

  private getResumeRunId(taskRun: TaskRun | null): string | null {
    // Env var takes precedence (set by backend infra)
    const envRunId = process.env.POSTHOG_RESUME_RUN_ID;
    if (envRunId) return envRunId;

    // Fallback: read from TaskRun state (set by API when creating the run)
    if (!taskRun) return null;
    const state = taskRun.state as Record<string, unknown> | undefined;
    const stateRunId = state?.resume_from_run_id;
    return typeof stateRunId === "string" && stateRunId.trim().length > 0
      ? stateRunId.trim()
      : null;
  }

  private buildSessionSystemPrompt(
    prUrl?: string | null,
    slackThreadUrl?: string | null,
  ): string | { append: string } {
    const cloudAppend = this.buildCloudSystemPrompt(prUrl, slackThreadUrl);
    const userPrompt = this.config.claudeCode?.systemPrompt;

    // String override: combine user prompt with cloud instructions
    if (typeof userPrompt === "string") {
      return [userPrompt, cloudAppend].join("\n\n");
    }

    // Preset with append: merge user append with cloud instructions
    if (typeof userPrompt === "object") {
      return {
        append: [userPrompt.append, cloudAppend].filter(Boolean).join("\n\n"),
      };
    }

    // Default: just cloud instructions
    return { append: cloudAppend };
  }

  private buildCodexInstructions(
    systemPrompt: string | { append: string },
  ): string {
    return typeof systemPrompt === "string"
      ? systemPrompt
      : systemPrompt.append;
  }

  /**
   * Builds the optional `claudeCode` session meta. Reasoning effort and plugins
   * are independent: effort must reach Claude even when no plugins are set, so
   * it cannot sit behind a plugins guard.
   */
  private buildClaudeCodeSessionMeta(
    runtimeAdapter: "claude" | "codex",
  ): { claudeCode: { options: Record<string, unknown> } } | undefined {
    const plugins = this.config.claudeCode?.plugins;
    const effort =
      runtimeAdapter === "claude" ? this.config.reasoningEffort : undefined;

    if (!plugins?.length && !effort) {
      return undefined;
    }

    const options: Record<string, unknown> = {};
    if (plugins?.length) {
      options.plugins = plugins;
    }
    if (effort) {
      options.effort = effort;
    }
    return { claudeCode: { options } };
  }

  private getCloudInteractionOrigin(): string | undefined {
    return (
      process.env.POSTHOG_CODE_INTERACTION_ORIGIN ??
      process.env.CODE_INTERACTION_ORIGIN ??
      process.env.TWIG_INTERACTION_ORIGIN
    );
  }

  /**
   * Automated-origin cloud runs auto-publish by default. Every other origin is
   * review-first unless the user explicitly asks, and createPr=false always
   * disables publishing.
   */
  private shouldAutoPublishCloudChanges(): boolean {
    const origin = this.getCloudInteractionOrigin();
    return (
      (origin === "slack" || origin === "signal_report") &&
      this.config.createPr !== false
    );
  }

  private buildDetectedPrContext(prUrl: string): string {
    if (!this.shouldAutoPublishCloudChanges()) {
      return (
        `An open pull request already exists: ${prUrl}\n` +
        `Use that PR as context if it is helpful, but stop with local changes ready for review.\n` +
        `Do NOT create commits, push to the PR branch, update the pull request, create a new branch, or create a new pull request unless the user explicitly asks.`
      );
    }

    return (
      `IMPORTANT — OVERRIDE PREVIOUS INSTRUCTIONS ABOUT CREATING BRANCHES/PRs.\n` +
      `You already have an open pull request: ${prUrl}\n` +
      `You MUST:\n` +
      `1. Check out the existing PR branch with \`gh pr checkout ${prUrl}\`\n` +
      `2. Make changes, commit, and push to that branch\n` +
      `You MUST NOT create a new branch, close the existing PR, or create a new PR.`
    );
  }

  private buildCloudSystemPrompt(
    prUrl?: string | null,
    slackThreadUrl?: string | null,
  ): string {
    const taskId = this.config.taskId;
    const shouldAutoCreatePr = this.shouldAutoPublishCloudChanges();
    const isSlack = this.getCloudInteractionOrigin() === "slack";
    const identityInstructions = isSlack
      ? `
# Identity
You are the PostHog Slack app, PostHog's agent for helping users with their product data and coding tasks from Slack. When introducing yourself or referring to yourself in messages to the user, identify as "PostHog Slack app". Do NOT refer to yourself as Claude, an Anthropic assistant, or any underlying model name.

# Response Style
You are replying in a Slack thread. Slack readers want short, skimmable answers — be concise by default.
- Answer simple questions in a single sentence. Keep everything else brief — a few sentences at most.
- Lead with the answer or the outcome. Skip preamble, restating the question, and sign-offs.
- Prefer plain prose. Treat bullet lists as the exception, not the norm, and avoid headers and tables unless they genuinely make a complex answer clearer.
- Do not narrate your thinking or list every step you took; report what matters and the result.
- This is a default, not a hard rule. If the user (or their saved memory) asks for more depth or a specific format, follow that instead.

# Mentioning users
To ping a Slack user, reuse a \`<@U…|displayname>\` token that already appears in the message context — copy it verbatim, including the \`U…\` ID. Do NOT construct a mention token from a name, and do NOT substitute the display name (or any other string) for the \`U…\` ID — \`<@Jane|Jane Doe>\` is not a valid mention; only the form with the real ID like \`<@U01ABCDEF23|Jane Doe>\` is. If the person you want to refer to has no \`<@U…|displayname>\` token anywhere in the thread context, write their name as plain text instead of inventing one.

# Suggesting code changes
You can also open pull requests directly from this Slack thread. When the user's question describes a problem with a plausible code-side fix — a bug visible in errors or logs, missing or broken instrumentation, a broken funnel step traceable to UI code, a stale config that lives in a repo — end your reply with a one-sentence offer to open a PR for the fix and ask if they want you to proceed. Skip the offer for pure data lookups with no actionable code change (e.g. "what was DAU yesterday?"), and skip it when the fix would clearly live outside any repo you can reach.
`
      : "";
    const signedCommitInstructions = `
## Committing (signed commits required)
Commits MUST be signed. \`git commit\` and \`git push\` are blocked in this environment.
To commit: stage your changes with \`git add\`, then call the \`git_signed_commit\` tool (full
name \`${SIGNED_COMMIT_QUALIFIED_TOOL_NAME}\`) with a \`message\` (and optional \`body\`/\`paths\`).
It creates a GitHub-signed ("Verified") commit on the branch and keeps your local checkout in
sync. To start a new branch, pass \`branch\` (prefixed with \`posthog-code/\`) — the tool creates
it on the remote for you.

## Updating from the base branch
To bring the base branch into your PR branch, call the \`git_signed_merge\` tool (full name
\`${SIGNED_MERGE_QUALIFIED_TOOL_NAME}\`) — it creates a Verified two-parent merge commit
server-side (like GitHub's "Update branch" button). NEVER run \`git merge\` followed by
\`git_signed_commit\`: a merge in progress is refused, because the commit API would linearize
the merge and dump every base-branch change into your PR. If \`git_signed_merge\` reports a
conflict, fix it with a rebase instead: \`git rebase origin/<base>\`, resolve, \`git rebase
--continue\`, then call \`git_signed_rewrite\`.

## Rewriting / force-pushing (rebases, conflict fixes)
\`git push --force\` is also blocked. To update a branch after a local rebase or conflict
resolution, rebase locally with normal \`git\` (resolve conflicts and finish with
\`git rebase --continue\`, NOT \`git commit\`), then call the \`git_signed_rewrite\` tool (full
name \`${SIGNED_REWRITE_QUALIFIED_TOOL_NAME}\`). It republishes the branch's commits as Verified
and atomically force-updates the remote branch. This is how you fix conflicts on an existing PR.
Histories containing merge commits are refused — rebase (which flattens merges) first.
If a signed-git tool refuses with a "merge in progress" or "leak" error, follow its recovery
instructions instead of retrying the same call.

## Re-committing to a branch with an open PR
Before committing again to a branch that already has an open PR, fetch it first. The remote
branch can advance between your commits — CI automation often auto-commits regenerated
artifacts (codegen, lockfiles, formatting) onto open PR branches, and collaborators can push
too. Committing from a stale local checkout silently reverts those commits, so
\`git_signed_commit\` refuses when the remote branch is ahead of your checkout. If it does, or
before your next commit, update your checkout — stash any uncommitted work across the update so
you don't lose it: \`git stash --include-untracked\`, \`git fetch origin <branch>\`,
\`git reset --hard origin/<branch>\`, \`git stash pop\` (resolve any conflicts), then re-stage
and commit. A soft/mixed reset would keep your stale files and re-commit the revert, so the
hard reset is the safe one here — your work is held in the stash.

## Attribution
Do NOT add "Co-Authored-By" trailers or "Generated with [Claude Code]" lines to your
commit messages. The \`git_signed_commit\` tool automatically appends the only trailers
we want:
  Generated-By: PostHog Code
  Task-Id: ${taskId}`;

    const whyContextInstruction = `   - Add a brief **Why** to the body — one or two sentences capturing the reason the user asked for this change (the motivation, not a restatement of the diff). Keep it short.`;
    const prFooter = slackThreadUrl
      ? `*Created with [PostHog Code](https://posthog.com/code?ref=pr) from a [Slack thread](${slackThreadUrl})*`
      : `*Created with [PostHog Code](https://posthog.com/code?ref=pr)*`;

    if (prUrl) {
      if (!shouldAutoCreatePr) {
        return `${identityInstructions}
# Cloud Task Execution

This task already has an open pull request: ${prUrl}

Do the requested work, but stop with local changes ready for review.

Important:
- Do NOT create new commits, push to the branch, or update the pull request unless the user explicitly asks.
- Do NOT create a new branch or a new pull request.
${signedCommitInstructions}
`;
      }

      return `${identityInstructions}
# Cloud Task Execution

This task already has an open pull request: ${prUrl}

After completing the requested changes:
1. Check out the existing PR branch with \`gh pr checkout ${prUrl}\`
2. Stage your changes with \`git add\`, then call the \`git_signed_commit\` tool with a clear \`message\` (do NOT use \`git commit\`/\`git push\` — they are blocked). This commits to the existing PR branch.
   - If the branch is behind its base, call the \`git_signed_merge\` tool first — it merges the base in server-side with a Verified merge commit. Only if it reports a conflict: fetch and rebase locally (\`git fetch origin <base>\`, \`git rebase origin/<base>\`, resolve, \`git rebase --continue\`), then call the \`git_signed_rewrite\` tool to force-update this same PR branch.
3. For every PR review comment or review thread you addressed, treat the thread as done only after BOTH of these:
   - Reply on the thread with a short note describing what changed (reference the commit SHA when useful) using \`gh api -X POST /repos/{owner}/{repo}/pulls/{n}/comments/{id}/replies -f body='...'\`.
   - Resolve the thread via the \`resolveReviewThread\` GraphQL mutation: \`gh api graphql -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' -f id="<thread-node-id>"\`.
   List unresolved threads first with \`gh api graphql -f query='{repository(owner:"<owner>",name:"<repo>"){pullRequest(number:<n>){reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{body}}}}}}}'\` so you can resolve each one you fixed.

Important:
- Do NOT create a new branch or a new pull request.
- Do NOT push fixes for review comments without replying to and resolving each related thread.
${signedCommitInstructions}
`;
    }

    if (!this.config.repositoryPath) {
      const publishInstructions =
        this.config.createPr === false
          ? `
When the user asks for code changes:
- You may clone a repository and make local edits in that clone
- Do NOT create branches, commits, push changes, or open pull requests in this run`
          : `
When the user explicitly asks to clone or work in a GitHub repository:
- Clone the repository into /tmp/workspace/repos/<owner>/<repo> using \`gh repo clone <owner>/<repo> /tmp/workspace/repos/<owner>/<repo>\`
- Work from inside that cloned repository for follow-up code changes
- If the user explicitly asks you to open or update a pull request, create a branch, stage your changes with \`git add\` and commit them with the \`git_signed_commit\` tool (do NOT use \`git commit\`/\`git push\` — they are blocked), and open a draft pull request from inside the clone. Before opening the PR, check the cloned repo for a PR template at \`.github/pull_request_template.md\` (or variants; fall back to the org's \`.github\` repo via \`gh api\`) and use it as the body structure, and search for matching open issues with \`gh issue list --search\` to include \`Closes #<n>\` / \`Refs #<n>\` links.
- Keep the PR description brief overall. Summarize only the most important changes — do NOT enumerate every change you made. A few sentences or bullets is plenty.
${whyContextInstruction.trimStart()}
- End the PR description with a horizontal rule followed by this footer line: ${prFooter}
- Do NOT create branches, commits, push changes, or open pull requests unless the user explicitly asks for that`;

      return `${identityInstructions}
# Cloud Task Execution — No Repository Mode

You are a helpful assistant with access to PostHog via MCP tools. You can help with both code tasks and data/analytics questions.

When the user asks about analytics, data, metrics, events, funnels, dashboards, feature flags, experiments, or anything PostHog-related:
- Use your PostHog MCP tools to query data, search insights, and provide real answers
- Do NOT tell the user to check an external analytics platform — you ARE the analytics platform
- Use tools like insight-query, query-run, event-definitions-list, and others to answer questions directly

When the user asks for code changes or software engineering tasks:
- Let them know you can help but don't have a repository connected for this session
- If they have not specified a repository to clone, offer to write code snippets, scripts, or provide guidance
${publishInstructions}

Important:
- Prefer using MCP tools to answer questions with real data over giving generic advice.
${signedCommitInstructions}
`;
    }

    if (!shouldAutoCreatePr) {
      return `${identityInstructions}
# Cloud Task Execution

Do the requested work, but stop with local changes ready for review.

Important:
- Do NOT create a branch, commit, push, or open a pull request unless the user explicitly asks.
${signedCommitInstructions}
`;
    }

    return `${identityInstructions}
# Cloud Task Execution

After completing the requested changes:
1. Pick a new branch name prefixed with \`posthog-code/\` (e.g. \`posthog-code/fix-login-redirect\`)
2. Stage your changes with \`git add\`, then call the \`git_signed_commit\` tool with \`branch\` set to that name and a clear \`message\` (do NOT use \`git commit\`/\`git push\` — they are blocked). The tool creates the branch on the remote and a signed commit on it.
3. Before opening the PR, prepare the body:
   - Keep the PR description brief overall. Summarize only the most important changes — do NOT enumerate every change you made. A few sentences or bullets is plenty.
${whyContextInstruction}
   - Check the repo for a PR template at \`.github/pull_request_template.md\` (also try \`.github/PULL_REQUEST_TEMPLATE.md\`, \`docs/pull_request_template.md\`, and root variants). If one exists, use its exact section headings as the PR body — do NOT fall back to a generic Summary/Test plan format.
   - If no repo-level template exists, check the org's \`.github\` repo via \`gh api /repos/<owner>/.github/contents/.github/pull_request_template.md\` (and other common paths) and use that as a fallback.
   - Search for matching open issues with \`gh issue list --state open --search '<keywords>'\` (derive keywords from the branch name, commits, and changed files; \`gh issue view <n>\` to confirm relevance). For every issue this PR would resolve, include a \`Closes #<n>\` line in the body so GitHub auto-links and auto-closes it on merge. For issues that are related but not fully resolved, use \`Refs #<n>\` instead.
4. Create a draft pull request using \`gh pr create --draft${this.config.baseBranch ? ` --base ${this.config.baseBranch}` : ""}\` with a descriptive title and the body prepared above. Add the following footer at the end of the PR description:
\`\`\`
---
${prFooter}
\`\`\`

Important:
- Always create the PR as a draft. Do not ask for confirmation.
${signedCommitInstructions}
`;
  }

  private async getCurrentGitBranch(): Promise<string | null> {
    if (!this.config.repositoryPath) {
      return null;
    }

    try {
      return await getCurrentBranch(this.config.repositoryPath);
    } catch (error) {
      this.logger.debug("Failed to determine current git branch", {
        repositoryPath: this.config.repositoryPath,
        error,
      });
      return null;
    }
  }

  private async syncCloudBranchMetadata(payload: JwtPayload): Promise<void> {
    const branchName = await this.getCurrentGitBranch();
    if (!branchName || branchName === this.lastReportedBranch) {
      return;
    }

    try {
      await this.posthogAPI.updateTaskRun(payload.task_id, payload.run_id, {
        branch: branchName,
        output: { head_branch: branchName },
      });
      this.lastReportedBranch = branchName;
    } catch (error) {
      this.logger.debug("Failed to attach current branch to task run", {
        taskId: payload.task_id,
        runId: payload.run_id,
        branchName,
        error,
      });
    }
  }

  private async signalTaskComplete(
    payload: JwtPayload,
    stopReason: string,
    errorMessage?: string,
  ): Promise<void> {
    if (this.session?.payload.run_id === payload.run_id) {
      try {
        await this.session.logWriter.flush(payload.run_id, {
          coalesce: true,
        });
      } catch (error) {
        this.logger.debug("Failed to flush session logs before completion", {
          taskId: payload.task_id,
          runId: payload.run_id,
          error,
        });
      }
    }

    if (stopReason !== "error") {
      this.logger.debug("Skipping status update for non-error stop reason", {
        stopReason,
      });
      return;
    }

    const status = "failed";

    this.enqueueTaskTerminalEvent(POSTHOG_NOTIFICATIONS.ERROR, {
      source: "agent_server",
      stopReason,
      error: errorMessage ?? "Agent error",
    });

    try {
      await this.posthogAPI.updateTaskRun(payload.task_id, payload.run_id, {
        status,
        error_message: errorMessage ?? "Agent error",
      });
      this.logger.debug("Task completion signaled", { status, stopReason });
    } catch (error) {
      this.logger.error("Failed to signal task completion", error);
    } finally {
      await this.eventStreamSender?.stop();
    }
  }

  private enqueueTaskTerminalEvent(
    method:
      | typeof POSTHOG_NOTIFICATIONS.TASK_COMPLETE
      | typeof POSTHOG_NOTIFICATIONS.ERROR,
    params: Record<string, unknown>,
  ): void {
    this.eventStreamSender?.enqueue({
      type: "notification",
      timestamp: new Date().toISOString(),
      notification: {
        jsonrpc: "2.0",
        method,
        params,
      },
    });
  }

  private configureEnvironment({
    isInternal = false,
    originProduct,
    signalReportId,
    aiStage,
    taskId,
    taskRunId,
    taskUserId,
    taskTitle,
  }: {
    isInternal?: boolean;
    originProduct?: Task["origin_product"] | null;
    signalReportId?: string | null;
    aiStage?: string | null;
    taskId?: string | null;
    taskRunId?: string | null;
    taskUserId?: number | null;
    taskTitle?: string | null;
  } = {}): GatewayEnv {
    const { apiKey, apiUrl, projectId } = this.config;
    const product = resolveGatewayProduct({ isInternal, originProduct });
    const gatewayUrl = resolveLlmGatewayUrl(
      process.env.LLM_GATEWAY_URL,
      apiUrl,
      product,
    );
    const openaiBaseUrl = gatewayUrl.endsWith("/v1")
      ? gatewayUrl
      : `${gatewayUrl}/v1`;
    // Forward task metadata as `x-posthog-property-*` headers so the gateway
    // lifts them onto the $ai_generation event. Routes through the Anthropic
    // SDK's ANTHROPIC_CUSTOM_HEADERS env var; the OpenAI/codex path has no
    // equivalent today. (The `team_id` attribution header is added downstream
    // in the Claude session builder from POSTHOG_PROJECT_ID — see
    // adapters/claude/session/options.ts.)
    const customHeaders = buildGatewayPropertyHeaders({
      task_origin_product: originProduct,
      task_internal: isInternal,
      signal_report_id: signalReportId,
      ai_stage: aiStage,
      task_id: taskId,
      task_run_id: taskRunId,
      task_user_id: taskUserId,
      task_title: taskTitle,
    });

    // Server-level constants that don't vary per task — safe to keep in
    // process.env so spawned tools (PostHog MCP, workspace-server, etc.) can
    // reach the PostHog API without explicit threading.
    Object.assign(process.env, {
      POSTHOG_API_KEY: apiKey,
      POSTHOG_API_URL: apiUrl,
      POSTHOG_API_HOST: apiUrl,
      POSTHOG_AUTH_HEADER: `Bearer ${apiKey}`,
      POSTHOG_PROJECT_ID: String(projectId),
    });

    // Task-specific gateway config is returned rather than written to
    // process.env so that concurrent sessions do not clobber each other's
    // gateway URL, auth token, or custom headers.
    return {
      anthropicBaseUrl: gatewayUrl,
      anthropicAuthToken: apiKey,
      openaiBaseUrl,
      openaiApiKey: apiKey,
      anthropicCustomHeaders: customHeaders,
      posthogProjectId: String(projectId),
    };
  }

  private buildSlackQuestionRelayResponse(
    payload: JwtPayload,
    toolMeta: Record<string, unknown> | null | undefined,
  ): RequestPermissionResponse {
    this.relaySlackQuestion(payload, toolMeta);
    return {
      outcome: { outcome: "cancelled" as const },
      _meta: {
        message:
          "This question has been relayed to the Slack thread where this task originated. " +
          "The user will reply there. Do NOT re-ask the question or pick an answer yourself. " +
          "Simply let the user know you are waiting for their reply.",
      },
    };
  }

  private shouldBlockPublishPermission(
    params: RequestPermissionRequest,
  ): boolean {
    if (this.config.createPr !== false) {
      return false;
    }

    const meta =
      params.toolCall?._meta &&
      typeof params.toolCall._meta === "object" &&
      !Array.isArray(params.toolCall._meta)
        ? (params.toolCall._meta as Record<string, unknown>)
        : null;
    const rawInput =
      params.toolCall?.rawInput &&
      typeof params.toolCall.rawInput === "object" &&
      !Array.isArray(params.toolCall.rawInput)
        ? (params.toolCall.rawInput as Record<string, unknown>)
        : null;
    const toolName = typeof meta?.toolName === "string" ? meta.toolName : null;
    const command =
      typeof rawInput?.command === "string" ? rawInput.command : null;

    return Boolean(
      toolName &&
        (toolName === "Bash" || toolName.includes("bash")) &&
        command &&
        /\bgit\s+push\b|\bgh\s+pr\s+(create|edit|ready|merge)\b/.test(command),
    );
  }

  private createCloudClient(payload: JwtPayload) {
    const mode = this.getEffectiveMode(payload);
    const interactionOrigin =
      process.env.POSTHOG_CODE_INTERACTION_ORIGIN ??
      process.env.CODE_INTERACTION_ORIGIN ??
      process.env.TWIG_INTERACTION_ORIGIN;

    return {
      requestPermission: async (
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> => {
        this.logger.debug("Permission request", {
          mode,
          interactionOrigin,
          kind: params.toolCall?.kind,
          options: params.options,
        });

        const allowOption = params.options.find(
          (o) => o.kind === "allow_once" || o.kind === "allow_always",
        );
        const selectedOptionId =
          allowOption?.optionId ?? params.options[0].optionId;

        const codeToolKind = params.toolCall?._meta?.codeToolKind;
        const isPlanApproval = params.toolCall?.kind === "switch_mode";

        // Relay questions to Slack when interaction originated there
        if (interactionOrigin === "slack") {
          if (codeToolKind === "question") {
            return this.buildSlackQuestionRelayResponse(
              payload,
              params.toolCall?._meta,
            );
          }
        }

        // Relay permission requests to the desktop app when:
        // - Plan approvals: always relay because they gate autonomy changes
        //   that require human confirmation (buffered until desktop connects)
        // - Questions: relay when desktop is connected
        // - Edit/bash in "default" mode: relay for manual approval
        // Other modes auto-approve. No client connected → auto-approve
        // (except plan approvals, which wait for a desktop).
        {
          const isQuestion = codeToolKind === "question";
          const sessionPermissionMode = this.getSessionPermissionMode();
          const needsDesktopApproval =
            isQuestion ||
            this.shouldRelayPermissionToClient(sessionPermissionMode);

          if (
            isPlanApproval ||
            (needsDesktopApproval && this.session?.hasDesktopConnected)
          ) {
            this.logger.debug("Relaying permission request", {
              kind: params.toolCall?.kind,
              isQuestion,
              hasDesktopConnected: this.session?.hasDesktopConnected ?? false,
              sessionPermissionMode,
            });
            return this.relayPermissionToClient(params);
          }
        }

        if (this.shouldBlockPublishPermission(params)) {
          return {
            outcome: { outcome: "cancelled" },
            _meta: {
              message:
                "This run is configured to stop before publishing. Do not push commits or create/update pull requests unless the user explicitly asks.",
            },
          };
        }

        return {
          outcome: {
            outcome: "selected" as const,
            optionId: selectedOptionId,
          },
        };
      },
      extNotification: async (
        method: string,
        params: Record<string, unknown>,
      ) => {
        this.logger.debug("Extension notification", { method, params });
      },
      sessionUpdate: async (params: {
        sessionId: string;
        update?: Record<string, unknown>;
      }) => {
        // Track permission mode changes for relay decisions
        if (
          params.update?.sessionUpdate === "current_mode_update" &&
          typeof params.update?.currentModeId === "string" &&
          this.session
        ) {
          this.session.permissionMode = params.update
            .currentModeId as PermissionMode;
          this.logger.debug("Permission mode updated", {
            mode: params.update.currentModeId,
          });
        }

        this.maybeAttachCreatedPr(payload, params.update);

        // session/update notifications flow through the tapped stream (like local transport)
        // Capture checkpoints for file-changing tools so cloud resumes restore
        // from git checkpoints rather than tree snapshots.
        if (params.update?.sessionUpdate === "tool_call_update") {
          const meta = (params.update?._meta as Record<string, unknown>)
            ?.claudeCode as Record<string, unknown> | undefined;
          const toolName = meta?.toolName as string | undefined;
          const toolResponse = meta?.toolResponse as
            | Record<string, unknown>
            | undefined;

          if (
            (toolName === "Write" ||
              toolName === "Edit" ||
              toolName === "MultiEdit" ||
              toolName === "Delete" ||
              toolName === "Move") &&
            toolResponse?.filePath
          ) {
            await this.captureCheckpointState();
          }
        }
      },
    };
  }

  private async relayAgentResponse(payload: JwtPayload): Promise<void> {
    if (!this.session) {
      return;
    }

    if (this.questionRelayedToSlack) {
      this.questionRelayedToSlack = false;
      return;
    }

    try {
      await this.session.logWriter.flush(payload.run_id, { coalesce: true });
    } catch (error) {
      this.logger.debug("Failed to flush logs before Slack relay", {
        taskId: payload.task_id,
        runId: payload.run_id,
        error,
      });
    }

    const message = this.session.logWriter.getFullAgentResponse(payload.run_id);
    if (!message) {
      this.logger.debug("No agent message found for Slack relay", {
        taskId: payload.task_id,
        runId: payload.run_id,
        sessionRegistered: this.session.logWriter.isRegistered(payload.run_id),
      });
      return;
    }

    try {
      await this.posthogAPI.relayMessage(
        payload.task_id,
        payload.run_id,
        message,
      );
    } catch (error) {
      this.logger.debug("Failed to relay initial agent response to Slack", {
        taskId: payload.task_id,
        runId: payload.run_id,
        error,
      });
    }
  }

  private relaySlackQuestion(
    payload: JwtPayload,
    toolMeta: Record<string, unknown> | null | undefined,
  ): void {
    const firstQuestion = this.getFirstQuestionMeta(toolMeta);
    if (!this.isQuestionMeta(firstQuestion)) {
      return;
    }

    let message = `*${firstQuestion.question}*\n\n`;
    if (firstQuestion.options?.length) {
      firstQuestion.options.forEach(
        (opt: { label: string; description?: string }, i: number) => {
          message += `${i + 1}. *${opt.label}*`;
          if (opt.description) message += ` — ${opt.description}`;
          message += "\n";
        },
      );
    }
    message += "\nReply in this thread with your choice.";

    this.questionRelayedToSlack = true;
    this.posthogAPI
      .relayMessage(payload.task_id, payload.run_id, message)
      .catch((err) =>
        this.logger.debug("Failed to relay question to Slack", { err }),
      );
  }

  private getFirstQuestionMeta(
    toolMeta: Record<string, unknown> | null | undefined,
  ): unknown {
    if (!toolMeta) {
      return null;
    }

    const questionsValue = toolMeta.questions;
    if (!Array.isArray(questionsValue) || questionsValue.length === 0) {
      return null;
    }

    return questionsValue[0];
  }

  private isQuestionMeta(value: unknown): value is {
    question: string;
    options?: Array<{ label: string; description?: string }>;
  } {
    if (!value || typeof value !== "object") {
      return false;
    }

    const candidate = value as {
      question?: unknown;
      options?: unknown;
    };

    if (typeof candidate.question !== "string") {
      return false;
    }

    if (candidate.options === undefined) {
      return true;
    }

    if (!Array.isArray(candidate.options)) {
      return false;
    }

    return candidate.options.every(
      (option) =>
        !!option &&
        typeof option === "object" &&
        typeof (option as { label?: unknown }).label === "string",
    );
  }

  private maybeAttachCreatedPr(
    payload: JwtPayload,
    update: Record<string, unknown> | undefined,
  ): void {
    if (this.prAttributed || !update) return;
    const prUrl = findPrUrl(JSON.stringify(update));
    if (!prUrl || this.evaluatedPrUrls.has(prUrl)) return;
    this.evaluatedPrUrls.add(prUrl);
    void this.attachPrIfCreatedThisRun(payload, prUrl);
  }

  private async attachPrIfCreatedThisRun(
    payload: JwtPayload,
    prUrl: string,
  ): Promise<void> {
    if (this.prAttributed) return;

    let createdAt: string | null;
    try {
      createdAt = await this.fetchPrCreatedAt(prUrl);
    } catch (err) {
      this.logger.debug("PR attribution lookup failed", {
        runId: payload.run_id,
        prUrl,
        error: err,
      });
      return;
    }

    if (!wasCreatedRecently(createdAt, Date.now())) return;
    // Re-check after the await: another URL may have attributed while we waited.
    if (this.prAttributed) return;

    this.prAttributed = true;
    this.detectedPrUrl = prUrl;

    try {
      await this.posthogAPI.updateTaskRun(payload.task_id, payload.run_id, {
        output: { pr_url: prUrl },
      });
      this.logger.debug("Attributed created PR to task run", {
        taskId: payload.task_id,
        runId: payload.run_id,
        prUrl,
      });
    } catch (err) {
      this.logger.error("Failed to attach PR URL to task run", {
        taskId: payload.task_id,
        runId: payload.run_id,
        prUrl,
        error: err,
      });
    }
  }

  private async fetchPrCreatedAt(prUrl: string): Promise<string | null> {
    const res = await execGh(["pr", "view", prUrl, "--json", "createdAt"], {
      cwd: this.config.repositoryPath,
      timeoutMs: 10_000,
    });
    if (res.exitCode !== 0) return null;
    try {
      return (
        (JSON.parse(res.stdout) as { createdAt?: string }).createdAt ?? null
      );
    } catch {
      return null;
    }
  }

  private async cleanupSession({
    completeEventStream = false,
  }: {
    completeEventStream?: boolean;
  } = {}): Promise<void> {
    if (!this.session) return;

    this.logger.debug("Cleaning up session");

    try {
      await this.captureCheckpointState(this.session.pendingHandoffGitState);
    } catch (error) {
      this.logger.error("Failed to capture final checkpoint state", error);
    }

    try {
      await this.session.logWriter.flush(this.session.payload.run_id, {
        coalesce: true,
      });
    } catch (error) {
      this.logger.error("Failed to flush session logs", error);
    }

    // Drain pending permissions before ACP cleanup to avoid deadlocks —
    // cleanup may await operations that are blocked on a permission response.
    for (const [, pending] of this.pendingPermissions) {
      pending.resolve({
        outcome: { outcome: "selected", optionId: "reject" },
        _meta: { customInput: "Session is shutting down." },
      });
    }
    this.pendingPermissions.clear();

    try {
      await this.session.acpConnection.cleanup();
    } catch (error) {
      this.logger.error("Failed to cleanup ACP connection", error);
    }

    if (this.session.sseController) {
      this.session.sseController.close();
    }

    if (completeEventStream) {
      await this.eventStreamSender?.stop();
    }

    this.pendingEvents = [];
    this.lastReportedBranch = null;
    this.session = null;
  }

  private async captureCheckpointState(
    localGitState?: HandoffLocalGitState,
  ): Promise<void> {
    if (!this.session || !this.config.repositoryPath) {
      return;
    }
    if (!this.posthogAPI) {
      this.logger.warn(
        "Skipping checkpoint capture: PostHog API client is not configured",
      );
      return;
    }

    const tracker = new HandoffCheckpointTracker({
      repositoryPath: this.config.repositoryPath ?? "/tmp/workspace",
      taskId: this.session.payload.task_id,
      runId: this.session.payload.run_id,
      apiClient: this.posthogAPI,
      logger: this.logger.child("HandoffCheckpoint"),
    });

    const checkpoint = await tracker.captureForHandoff(localGitState);
    if (!checkpoint) return;

    const checkpointWithDevice: GitCheckpointEvent = {
      ...checkpoint,
      device: this.session.deviceInfo,
    };

    const notification = {
      jsonrpc: "2.0" as const,
      method: POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT,
      params: checkpointWithDevice,
    };

    this.broadcastEvent({
      type: "notification",
      timestamp: new Date().toISOString(),
      notification,
    });

    this.session.logWriter.appendRawLine(
      this.session.payload.run_id,
      JSON.stringify(notification),
    );
  }

  private extractHandoffLocalGitState(
    params: Record<string, unknown>,
  ): HandoffLocalGitState | null {
    const result = handoffLocalGitStateSchema.safeParse(params.localGitState);
    return result.success ? result.data : null;
  }

  private broadcastTurnComplete(stopReason: string): void {
    if (!this.session) return;
    if (this.adapterEmittedTurnComplete) {
      this.adapterEmittedTurnComplete = false;
      return;
    }
    const notification = {
      jsonrpc: "2.0",
      method: POSTHOG_NOTIFICATIONS.TURN_COMPLETE,
      params: {
        sessionId: this.session.acpSessionId,
        stopReason,
      },
    };

    this.broadcastEvent({
      type: "notification",
      timestamp: new Date().toISOString(),
      notification,
    });

    this.session.logWriter.appendRawLine(
      this.session.payload.run_id,
      JSON.stringify(notification),
    );
  }

  private broadcastEvent(event: Record<string, unknown>): void {
    if (!this.session) return;

    this.eventStreamSender?.enqueue(event);

    if (this.session?.sseController) {
      this.sendSseEvent(this.session.sseController, event);
    } else {
      // Buffer events during initialization (sseController not yet attached)
      this.pendingEvents.push(event);
    }
  }

  private replayPendingEvents(): void {
    if (!this.session?.sseController || this.pendingEvents.length === 0) return;
    const events = this.pendingEvents;
    this.pendingEvents = [];
    for (const event of events) {
      this.sendSseEvent(this.session.sseController, event);
    }
  }

  private sendSseEvent(controller: SseController, data: unknown): void {
    try {
      controller.send(data);
    } catch {
      this.detachSseController(controller);
    }
  }

  /**
   * Relay a permission request (e.g., plan approval) to the connected desktop
   * app via SSE and wait for a response via the `/command` endpoint.
   *
   * The promise waits indefinitely — if SSE is disconnected, the event is
   * buffered by broadcastEvent and replayed when the client reconnects. Session
   * cleanup force-resolves all pending permissions, so there is no leak.
   */
  private relayPermissionToClient(params: {
    options: Array<{ kind: string; optionId: string; name?: string }>;
    toolCall?: Record<string, unknown> | null;
  }): Promise<{
    outcome: { outcome: "selected"; optionId: string };
    _meta?: Record<string, unknown>;
  }> {
    const requestId = crypto.randomUUID();
    const toolCallId = params.toolCall?.toolCallId as string | undefined;

    this.broadcastEvent({
      type: "permission_request",
      requestId,
      options: params.options,
      toolCall: params.toolCall,
    });

    // Persist the request so a client that connects after the live event can
    // recover the requestId from the log and re-surface the prompt.
    this.persistPermissionLifecycle(POSTHOG_NOTIFICATIONS.PERMISSION_REQUEST, {
      requestId,
      toolCallId,
      options: params.options,
      toolCall: params.toolCall,
    });

    return new Promise((resolve) => {
      this.pendingPermissions.set(requestId, { resolve, toolCallId });
    });
  }

  private persistPermissionLifecycle(
    method: string,
    params: Record<string, unknown>,
  ): void {
    if (!this.session) return;
    // appendRawLine wraps the line in the {type, timestamp, notification}
    // envelope, so pass the bare notification (matching broadcastTurnComplete).
    this.session.logWriter.appendRawLine(
      this.session.payload.run_id,
      JSON.stringify({ jsonrpc: "2.0", method, params }),
    );
  }

  private resolvePermission(
    requestId: string,
    optionId: string,
    customInput?: string,
    answers?: Record<string, string>,
  ): boolean {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return false;

    this.pendingPermissions.delete(requestId);

    this.persistPermissionLifecycle(POSTHOG_NOTIFICATIONS.PERMISSION_RESOLVED, {
      requestId,
      toolCallId: pending.toolCallId,
      optionId,
    });

    const meta: Record<string, unknown> = {};
    if (customInput) meta.customInput = customInput;
    if (answers) meta.answers = answers;

    pending.resolve({
      outcome: { outcome: "selected" as const, optionId },
      ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
    });
    return true;
  }
}
