import type {
  AgentSideConnection,
  ContentBlock,
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  StopReason,
} from "@agentclientprotocol/sdk";
import { DEFAULT_CODEX_MODEL } from "../../gateway-models";
import type { ProcessSpawnedCallback } from "../../types";
import { Logger } from "../../utils/logger";
import {
  nodeReadableToWebReadable,
  nodeWritableToWebWritable,
} from "../../utils/streams";
import { BaseAcpAgent, type BaseSettingsManager } from "../base-acp-agent";
import {
  AppServerClient,
  type AppServerClientHandlers,
  type AppServerRpc,
} from "./app-server-client";
import { mapAppServerNotification } from "./mapping";
import {
  APP_SERVER_METHODS,
  APP_SERVER_NOTIFICATIONS,
  APP_SERVER_REQUESTS,
} from "./protocol";
import {
  type CodexAppServerProcess,
  type CodexAppServerProcessOptions,
  spawnCodexAppServerProcess,
} from "./spawn";

// The native app-server owns its own configuration, so there is nothing for the
// host to manage. BaseAcpAgent only calls dispose() on this.
class NoopSettingsManager implements BaseSettingsManager {
  constructor(private cwd: string) {}
  dispose(): void {}
  getCwd(): string {
    return this.cwd;
  }
  async setCwd(cwd: string): Promise<void> {
    this.cwd = cwd;
  }
  async initialize(): Promise<void> {}
}

export interface CodexAppServerAgentOptions {
  processOptions: CodexAppServerProcessOptions;
  /** Model id passed to thread/start. */
  model?: string;
  /** Reasoning effort passed to turn/start. */
  reasoningEffort?: string;
  processCallbacks?: ProcessSpawnedCallback;
  logger?: Logger;
  /** Test seam: build the JSON-RPC client (defaults to spawning the process). */
  rpcFactory?: (handlers: AppServerClientHandlers) => AppServerRpc;
}

/**
 * ACP Agent backed by the native Codex `app-server` protocol. Presents the same
 * ACP surface to PostHog Code as the codex-acp adapter, but talks to Codex's own
 * JSON-RPC protocol underneath instead of going through the Zed translation layer.
 *
 * Spike scope: covers the core lifecycle (initialize, thread/start, turn/start
 * with streamed agent messages, interrupt, approvals). Resume/fork, tool-call
 * rendering, structured output and usage accounting are follow-ups.
 */
export class CodexAppServerAgent extends BaseAcpAgent {
  readonly adapterName = "codex";
  private readonly rpc: AppServerRpc;
  private readonly proc?: CodexAppServerProcess;
  private readonly model: string;
  private readonly reasoningEffort?: string;
  private threadId?: string;
  private pendingTurn?: {
    resolve: (reason: StopReason) => void;
    reject: (err: Error) => void;
  };

  constructor(
    client: AgentSideConnection,
    options: CodexAppServerAgentOptions,
  ) {
    super(client);
    this.logger =
      options.logger ??
      new Logger({ debug: true, prefix: "[CodexAppServerAgent]" });
    this.model = options.model ?? DEFAULT_CODEX_MODEL;
    this.reasoningEffort = options.reasoningEffort;

    const handlers: AppServerClientHandlers = {
      logger: this.logger,
      onNotification: (method, params) =>
        this.handleNotification(method, params),
      onRequest: (method, params) => this.handleApproval(method, params),
      onClose: () => this.handleServerClosed(),
    };

    if (options.rpcFactory) {
      this.rpc = options.rpcFactory(handlers);
    } else {
      this.proc = spawnCodexAppServerProcess({
        ...options.processOptions,
        logger: this.logger,
        processCallbacks: options.processCallbacks,
      });
      this.rpc = new AppServerClient(
        {
          readable: nodeReadableToWebReadable(this.proc.stdout),
          writable: nodeWritableToWebWritable(this.proc.stdin),
        },
        handlers,
      );
    }

    this.session = {
      abortController: new AbortController(),
      settingsManager: new NoopSettingsManager(
        options.processOptions.cwd ?? process.cwd(),
      ),
      notificationHistory: [],
      cancelled: false,
    };
  }

  async initialize(request: InitializeRequest): Promise<InitializeResponse> {
    await this.rpc.request(APP_SERVER_METHODS.INITIALIZE, {
      clientInfo: {
        name: "posthog-code",
        title: "PostHog Code",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: false },
    });
    this.rpc.notify(APP_SERVER_NOTIFICATIONS.INITIALIZED, {});
    return {
      protocolVersion: request.protocolVersion,
      agentInfo: {
        name: "codex",
        title: "Codex (app-server)",
        version: "0.1.0",
      },
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const result = await this.rpc.request<{ thread?: { id?: string } }>(
      APP_SERVER_METHODS.THREAD_START,
      { model: this.model, cwd: params.cwd },
    );
    const threadId = result?.thread?.id;
    if (!threadId) {
      throw new Error("codex app-server thread/start returned no thread id");
    }
    this.threadId = threadId;
    this.sessionId = threadId;
    this.logger.info("Codex app-server session created", { threadId });
    return { sessionId: threadId };
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    if (!this.threadId) {
      throw new Error("prompt() called before newSession()");
    }
    if (this.pendingTurn) {
      // The host serializes turns; a concurrent prompt would clobber the
      // single pendingTurn slot, so fail fast rather than corrupt it.
      throw new Error("prompt() called while a turn is already in progress");
    }
    this.session.cancelled = false;
    const input = toTurnInput(params.prompt);
    const dropped = params.prompt.length - input.length;
    if (dropped > 0) {
      this.logger.warn("Dropped non-text prompt blocks", { dropped });
    }
    const completion = new Promise<StopReason>((resolve, reject) => {
      this.pendingTurn = { resolve, reject };
    });
    try {
      await this.rpc.request(APP_SERVER_METHODS.TURN_START, {
        threadId: this.threadId,
        input,
        ...(this.reasoningEffort ? { effort: this.reasoningEffort } : {}),
      });
      return { stopReason: await completion };
    } finally {
      this.pendingTurn = undefined;
    }
  }

  protected async interrupt(): Promise<void> {
    // Tell the server to stop first, then report the turn cancelled, so the
    // caller never sees "cancelled" while Codex is still running.
    if (this.threadId) {
      await this.rpc
        .request(APP_SERVER_METHODS.TURN_INTERRUPT, { threadId: this.threadId })
        .catch((err) => this.logger.warn("turn/interrupt failed", err));
    }
    this.pendingTurn?.resolve("cancelled");
    this.pendingTurn = undefined;
  }

  async closeSession(): Promise<void> {
    this.session.abortController.abort();
    this.pendingTurn?.resolve("cancelled");
    this.pendingTurn = undefined;
    this.session.settingsManager.dispose();
    this.proc?.kill();
    await this.rpc.close();
  }

  private handleNotification(method: string, params: unknown): void {
    if (this.sessionId && !this.session.cancelled) {
      const notification = mapAppServerNotification(
        this.sessionId,
        method,
        params,
      );
      if (notification) {
        void this.client
          .sessionUpdate(notification)
          .catch((err) => this.logger.warn("sessionUpdate failed", err));
        this.appendNotification(this.sessionId, notification);
      }
    }

    if (method === APP_SERVER_NOTIFICATIONS.TURN_COMPLETED) {
      const status = (params as { turn?: { status?: string } })?.turn?.status;
      this.pendingTurn?.resolve(status === "failed" ? "refusal" : "end_turn");
      this.pendingTurn = undefined;
    }
  }

  private handleServerClosed(): void {
    this.pendingTurn?.reject(
      new Error("codex app-server exited before the turn completed"),
    );
    this.pendingTurn = undefined;
  }

  private async handleApproval(
    method: string,
    params: unknown,
  ): Promise<string> {
    if (
      method !== APP_SERVER_REQUESTS.COMMAND_APPROVAL &&
      method !== APP_SERVER_REQUESTS.FILE_CHANGE_APPROVAL
    ) {
      this.logger.warn("Unrecognized server request; declining", { method });
      return "decline";
    }
    const detail = params as { itemId?: string; command?: string };
    const title =
      detail.command ??
      (method === APP_SERVER_REQUESTS.FILE_CHANGE_APPROVAL
        ? "Apply file changes"
        : "Run command");
    try {
      const response = await this.client.requestPermission({
        sessionId: this.sessionId,
        toolCall: { toolCallId: detail.itemId ?? "codex-approval", title },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      });
      if (
        response.outcome.outcome === "selected" &&
        response.outcome.optionId === "allow"
      ) {
        return "accept";
      }
      if (response.outcome.outcome === "cancelled") {
        return "cancel";
      }
      return "decline";
    } catch (err) {
      this.logger.warn("requestPermission failed; declining", err);
      return "decline";
    }
  }
}

function toTurnInput(
  prompt: ContentBlock[],
): Array<{ type: "text"; text: string }> {
  const input: Array<{ type: "text"; text: string }> = [];
  for (const block of prompt) {
    if (block.type === "text") {
      input.push({ type: "text", text: block.text });
    }
  }
  return input;
}
