/**
 * In-process ACP proxy agent for Codex.
 *
 * Implements the ACP Agent interface and delegates to the codex-acp binary
 * via a ClientSideConnection. This gives us interception points for:
 * - PostHog-specific notifications (sdk_session, usage_update, turn_complete)
 * - Session resume/fork (not natively supported by codex-acp)
 * - Usage accumulation
 * - System prompt injection
 */

import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import {
  type AgentSideConnection,
  type AuthenticateRequest,
  ClientSideConnection,
  type ForkSessionRequest,
  type ForkSessionResponse,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type McpServer,
  type McpServerStdio,
  type NewSessionRequest,
  type NewSessionResponse,
  ndJsonStream,
  type PromptRequest,
  type PromptResponse,
  RequestError,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
} from "@agentclientprotocol/sdk";
import { ghTokenEnv } from "@posthog/git/signed-commit";
import packageJson from "../../../package.json" with { type: "json" };
import {
  isMethod,
  POSTHOG_METHODS,
  POSTHOG_NOTIFICATIONS,
} from "../../acp-extensions";
import {
  createEnrichment,
  type Enrichment,
} from "../../enrichment/file-enricher";
import {
  type CodeExecutionMode,
  type CodexNativeMode,
  isCodeExecutionMode,
  isCodexNativeMode,
  type PermissionMode,
} from "../../execution-mode";
import type { PostHogAPIConfig, ProcessSpawnedCallback } from "../../types";
import { isCloudRun } from "../../utils/common";
import { resolveGithubToken } from "../../utils/github-token";
import { Logger } from "../../utils/logger";
import {
  nodeReadableToWebReadable,
  nodeWritableToWebWritable,
} from "../../utils/streams";
import { BaseAcpAgent, type BaseSession } from "../base-acp-agent";
import {
  buildBreakdown,
  type ContextBreakdownBaseline,
  emptyBaseline,
  estimateTokens,
} from "../claude/context-breakdown";
import { classifyAgentError } from "../error-classification";
import {
  enabledLocalTools,
  LOCAL_TOOLS_MCP_NAME,
  type LocalToolCtx,
} from "../local-tools";
import { resolveTaskId } from "../session-meta";
import { createCodexClient } from "./codex-client";
import {
  modelIdFromConfigOptions,
  normalizeCodexConfigOptions,
} from "./models";
import {
  type CodexSessionState,
  createSessionState,
  resetSessionState,
  resetUsage,
} from "./session-state";
import { CodexSettingsManager } from "./settings";
import {
  type CodexProcess,
  type CodexProcessOptions,
  spawnCodexProcess,
} from "./spawn";
import {
  STRUCTURED_OUTPUT_MCP_NAME,
  STRUCTURED_OUTPUT_TOOL_NAME,
} from "./structured-output-constants";

export {
  STRUCTURED_OUTPUT_MCP_NAME,
  STRUCTURED_OUTPUT_TOOL_NAME,
} from "./structured-output-constants";

interface NewSessionMeta {
  taskRunId?: string;
  taskId?: string;
  environment?: "local" | "cloud";
  systemPrompt?: string;
  permissionMode?: string;
  model?: string;
  baseBranch?: string;
  persistence?: { taskId?: string; runId?: string; logUrl?: string };
  claudeCode?: {
    options?: Record<string, unknown>;
  };
  additionalRoots?: string[];
  disableBuiltInTools?: boolean;
  allowedDomains?: string[];
  jsonSchema?: Record<string, unknown> | null;
}

export interface CodexAcpAgentOptions {
  codexProcessOptions: CodexProcessOptions;
  processCallbacks?: ProcessSpawnedCallback;
  posthogApiConfig?: PostHogAPIConfig;
  onStructuredOutput?: (output: Record<string, unknown>) => Promise<void>;
  /**
   * Logger wired to the host log sink. Without it the codex-acp subprocess
   * stderr, spawn failures and exit codes are written to a throwaway logger and
   * never reach the exported logs, so a crash surfaces only as a generic
   * "ACP connection closed" with no cause.
   */
  logger?: Logger;
}

type CodexSession = BaseSession & {
  settingsManager: CodexSettingsManager;
  promptRunning: boolean;
};

function toCodexPermissionMode(mode?: string): PermissionMode {
  if (mode && (isCodexNativeMode(mode) || isCodeExecutionMode(mode))) {
    return mode;
  }
  return "auto";
}

/**
 * Prepend `_meta.prContext` (set by the agent-server on Slack-originated
 * follow-up runs) to the prompt as a text block, mirroring Claude's
 * `promptToClaude` behavior. Without this, codex cloud runs lose the
 * PR-review context that follow-up flows rely on.
 */
function prependPrContext(params: PromptRequest): PromptRequest {
  const prContext = (params._meta as Record<string, unknown> | undefined)
    ?.prContext;
  if (typeof prContext !== "string" || prContext.length === 0) {
    return params;
  }
  return {
    ...params,
    prompt: [{ type: "text", text: prContext }, ...params.prompt],
  };
}

function classifyPromptError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const classification = classifyAgentError(message);
  if (classification === "agent_error") {
    return error;
  }

  return RequestError.internalError(
    { classification, result: message },
    message,
  );
}

// codex-rs/protocol/src/protocol.rs BASELINE_TOKENS — the always-resident
// floor (MCP schemas, skills, preset prompt) we can't attribute per-source.
const CODEX_BASELINE_TOKENS = 12000;

function buildCodexBaseline(
  meta: NewSessionMeta | undefined,
): ContextBreakdownBaseline {
  const baseline = emptyBaseline();
  baseline.systemPrompt =
    CODEX_BASELINE_TOKENS + estimateTokens(meta?.systemPrompt);
  return baseline;
}

const CODEX_NATIVE_MODE: Record<CodeExecutionMode, CodexNativeMode> = {
  auto: "auto",
  default: "auto",
  acceptEdits: "auto",
  plan: "read-only",
  bypassPermissions: "full-access",
};

function toCodexNativeMode(mode?: string): CodexNativeMode {
  if (mode && isCodexNativeMode(mode)) {
    return mode;
  }
  if (mode && isCodeExecutionMode(mode)) {
    return CODEX_NATIVE_MODE[mode];
  }
  return "auto";
}

function getCurrentPermissionMode(
  currentModeId?: string,
  fallbackMode?: string,
): PermissionMode {
  if (currentModeId && isCodexNativeMode(currentModeId)) {
    return currentModeId;
  }

  return toCodexPermissionMode(fallbackMode);
}

const STRUCTURED_OUTPUT_INSTRUCTIONS = `\n\nWhen you have completed the task, call the \`${STRUCTURED_OUTPUT_TOOL_NAME}\` tool with the final structured result. The tool's input schema matches the required output format for this task. Do not describe the result in a plain message — submitting it via the tool is required for the task to be considered complete.`;

/**
 * Builds the stdio MCP server config that exposes the `create_output` tool.
 * The child process validates tool input against the JSON schema with AJV.
 * We pass the schema as a base64-encoded env var to avoid shell escaping.
 *
 * Path resolves relative to the compiled adapter location. When bundled into
 * different entry points (dist/agent.js, dist/server/bin.cjs, dist/server/
 * harness/bin.js, etc), `import.meta.dirname` sits at different depths. Walk
 * up until we find the script so each bundle locates the shared dist asset.
 */
function resolveBundledMcpScript(rel: string): string {
  let dir = import.meta.dirname ?? __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = resolvePath(dir, rel);
    if (existsSync(candidate)) return candidate;
    dir = resolvePath(dir, "..");
  }
  throw new Error(
    `Could not locate ${rel} relative to ${import.meta.dirname ?? __dirname}.`,
  );
}

function buildStructuredOutputMcpServer(
  jsonSchema: Record<string, unknown>,
): McpServerStdio {
  const scriptPath = resolveBundledMcpScript(
    "adapters/codex/structured-output-mcp-server.js",
  );
  const schemaBase64 = Buffer.from(JSON.stringify(jsonSchema)).toString(
    "base64",
  );
  return {
    name: STRUCTURED_OUTPUT_MCP_NAME,
    command: process.execPath,
    args: [scriptPath],
    env: [{ name: "POSTHOG_OUTPUT_SCHEMA", value: schemaBase64 }],
  };
}

/**
 * Builds the stdio MCP server config exposing the enabled local tools. Context
 * (cwd, taskId, token) and the enabled tool names are passed base64/CSV-encoded
 * so the child registers the same tools the Claude adapter exposes in-process.
 */
function buildLocalToolsMcpServer(
  ctx: LocalToolCtx,
  enabledNames: string[],
): McpServerStdio {
  const scriptPath = resolveBundledMcpScript(
    "adapters/codex/local-tools-mcp-server.js",
  );
  const ctxBase64 = Buffer.from(JSON.stringify(ctx)).toString("base64");
  const env = [
    { name: "POSTHOG_LOCAL_TOOLS_CTX", value: ctxBase64 },
    { name: "POSTHOG_LOCAL_TOOLS_ENABLED", value: enabledNames.join(",") },
  ];
  if (ctx.token) {
    // Token also on the child env so its own git remote ops (fetch/ls-remote)
    // authenticate; the var names come from the single shared source.
    env.push(
      ...Object.entries(ghTokenEnv(ctx.token)).map(([name, value]) => ({
        name,
        value,
      })),
    );
  }
  return {
    name: LOCAL_TOOLS_MCP_NAME,
    command: process.execPath,
    args: [scriptPath],
    env,
  };
}

export class CodexAcpAgent extends BaseAcpAgent {
  readonly adapterName = "codex";
  declare session: CodexSession;
  private codexProcess: CodexProcess;
  private codexConnection: ClientSideConnection;
  private sessionState: CodexSessionState;
  /**
   * FIFO serializer for prompt() calls. codex-acp and codex-rs themselves
   * serialize submissions at the conversation level, but our adapter
   * accumulates per-turn usage into sessionState.accumulatedUsage via the
   * codex-client sessionUpdate handler. If two prompts ran concurrently on
   * the JS side, the second's resetUsage() would wipe out the first's
   * in-flight counters and both TURN_COMPLETE notifications would report
   * garbled totals. Serializing on the JS side keeps the accumulator
   * single-owner.
   */
  private promptMutex: Promise<unknown> = Promise.resolve();
  private readonly codexProcessOptions: CodexProcessOptions;
  private readonly processCallbacks?: ProcessSpawnedCallback;
  private readonly onStructuredOutput?: (
    output: Record<string, unknown>,
  ) => Promise<void>;
  // Snapshot of the initialize() request so refreshSession can replay the
  // same handshake against a respawned codex-acp subprocess.
  private lastInitRequest?: InitializeRequest;
  private enrichment?: Enrichment;

  constructor(client: AgentSideConnection, options: CodexAcpAgentOptions) {
    super(client);
    this.logger =
      options.logger ?? new Logger({ debug: true, prefix: "[CodexAcpAgent]" });

    // Load user codex settings before spawning so spawnCodexProcess can
    // filter out any [mcp_servers.*] entries from ~/.codex/config.toml.
    const cwd = options.codexProcessOptions.cwd ?? process.cwd();
    const settingsManager = new CodexSettingsManager(cwd);

    this.codexProcessOptions = options.codexProcessOptions;
    this.processCallbacks = options.processCallbacks;
    this.onStructuredOutput = options.onStructuredOutput;

    // Spawn the codex-acp subprocess
    this.codexProcess = spawnCodexProcess({
      ...options.codexProcessOptions,
      settings: settingsManager.getSettings(),
      logger: this.logger,
      processCallbacks: options.processCallbacks,
    });

    // Create ACP connection to codex-acp over stdin/stdout
    const codexReadable = nodeReadableToWebReadable(this.codexProcess.stdout);
    const codexWritable = nodeWritableToWebWritable(this.codexProcess.stdin);
    const codexStream = ndJsonStream(codexWritable, codexReadable);

    const abortController = new AbortController();
    this.session = {
      abortController,
      settingsManager,
      notificationHistory: [],
      cancelled: false,
      promptRunning: false,
    };

    this.sessionState = createSessionState("", cwd);

    this.enrichment = createEnrichment(options.posthogApiConfig, this.logger);

    // Create the ClientSideConnection to codex-acp.
    // The Client handler delegates all requests from codex-acp to the upstream
    // PostHog Code client via our AgentSideConnection.
    this.codexConnection = new ClientSideConnection(
      (_agent) =>
        createCodexClient(this.client, this.logger, this.sessionState, {
          enrichmentDeps: this.enrichment?.deps,
          onStructuredOutput: this.onStructuredOutput,
        }),
      codexStream,
    );
  }

  async initialize(request: InitializeRequest): Promise<InitializeResponse> {
    // Initialize settings
    await this.session.settingsManager.initialize();

    // Snapshot the handshake so refreshSession can replay it after respawn.
    this.lastInitRequest = request;

    // Forward to codex-acp
    const response = await this.codexConnection.initialize(request);

    // Merge our enhanced capabilities
    return {
      ...response,
      agentCapabilities: {
        ...response.agentCapabilities,
        sessionCapabilities: {
          ...response.agentCapabilities?.sessionCapabilities,
          resume: {},
          fork: {},
        },
        _meta: {
          posthog: {
            resumeSession: true,
            steering: "interrupt-resend",
          },
        },
      },
      agentInfo: {
        name: packageJson.name,
        title: "Codex Agent",
        version: packageJson.version,
      },
    };
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const meta = params._meta as NewSessionMeta | undefined;
    const requestedPermissionMode = toCodexPermissionMode(meta?.permissionMode);

    const injectedParams = this.applyLocalTools(
      this.applyStructuredOutput(params, meta),
      meta,
    );
    const response = await this.codexConnection.newSession(injectedParams);
    response.configOptions = normalizeCodexConfigOptions(
      response.configOptions,
    );

    // Initialize session state. Mutate in place — codex-client closure-
    // captured this object in the constructor and writes contextUsed/
    // accumulatedUsage to it on every upstream usage_update.
    resetSessionState(this.sessionState, response.sessionId, params.cwd, {
      taskRunId: meta?.taskRunId,
      taskId: resolveTaskId(meta),
      modeId: response.modes?.currentModeId ?? "auto",
      modelId: modelIdFromConfigOptions(response.configOptions),
      permissionMode: requestedPermissionMode,
    });
    this.sessionId = response.sessionId;
    this.sessionState.configOptions = response.configOptions ?? [];
    this.sessionState.contextBreakdownBaseline = buildCodexBaseline(meta);

    await this.applyInitialPermissionMode(
      response.sessionId,
      meta?.permissionMode,
      response.modes?.currentModeId,
    );

    // Emit _posthog/sdk_session so the app can track the session
    if (meta?.taskRunId) {
      await this.client.extNotification(POSTHOG_NOTIFICATIONS.SDK_SESSION, {
        taskRunId: meta.taskRunId,
        sessionId: response.sessionId,
        adapter: "codex",
      });
    }

    this.logger.info("Codex session created", {
      sessionId: response.sessionId,
      taskRunId: meta?.taskRunId,
    });

    return response;
  }

  async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    const meta = params._meta as NewSessionMeta | undefined;
    const injectedParams = this.applyLocalTools(
      this.applyStructuredOutput(params, meta),
      meta,
    );
    const response = await this.codexConnection.loadSession(injectedParams);
    response.configOptions = normalizeCodexConfigOptions(
      response.configOptions,
    );
    const currentPermissionMode = getCurrentPermissionMode(
      response.modes?.currentModeId,
      meta?.permissionMode,
    );

    // Carry taskRunId/taskId across load so prompt() still emits cloud
    // notifications (TURN_COMPLETE, USAGE_UPDATE) after a reload. newSession
    // and resumeSession both do this; loadSession historically did
    // not, which silently broke task-completion tracking on re-attach.
    resetSessionState(this.sessionState, params.sessionId, params.cwd, {
      taskRunId: meta?.taskRunId,
      taskId: resolveTaskId(meta),
      modeId: response.modes?.currentModeId ?? "auto",
      permissionMode: currentPermissionMode,
    });
    this.sessionId = params.sessionId;
    this.sessionState.configOptions = response.configOptions ?? [];
    this.sessionState.contextBreakdownBaseline = buildCodexBaseline(meta);

    if (meta?.taskRunId) {
      await this.client.extNotification(POSTHOG_NOTIFICATIONS.SDK_SESSION, {
        taskRunId: meta.taskRunId,
        sessionId: params.sessionId,
        adapter: "codex",
      });
    }

    return response;
  }

  async resumeSession(
    params: ResumeSessionRequest,
  ): Promise<ResumeSessionResponse> {
    const meta = params._meta as NewSessionMeta | undefined;
    const injectedParams = this.applyLocalTools(
      this.applyStructuredOutput(
        {
          sessionId: params.sessionId,
          cwd: params.cwd,
          mcpServers: params.mcpServers ?? [],
          _meta: params._meta,
        },
        meta,
      ),
      meta,
    );

    // codex-acp doesn't support resume natively, use loadSession instead
    const loadResponse = await this.codexConnection.loadSession(injectedParams);
    loadResponse.configOptions = normalizeCodexConfigOptions(
      loadResponse.configOptions,
    );
    const currentPermissionMode = getCurrentPermissionMode(
      loadResponse.modes?.currentModeId,
      meta?.permissionMode,
    );
    resetSessionState(this.sessionState, params.sessionId, params.cwd, {
      taskRunId: meta?.taskRunId,
      taskId: resolveTaskId(meta),
      modeId: loadResponse.modes?.currentModeId ?? "auto",
      permissionMode: currentPermissionMode,
    });
    this.sessionId = params.sessionId;
    this.sessionState.configOptions = loadResponse.configOptions ?? [];
    this.sessionState.contextBreakdownBaseline = buildCodexBaseline(meta);

    if (meta?.taskRunId) {
      await this.client.extNotification(POSTHOG_NOTIFICATIONS.SDK_SESSION, {
        taskRunId: meta.taskRunId,
        sessionId: params.sessionId,
        adapter: "codex",
      });
    }

    return {
      modes: loadResponse.modes,
      configOptions: loadResponse.configOptions,
    };
  }

  async unstable_forkSession(
    params: ForkSessionRequest,
  ): Promise<ForkSessionResponse> {
    const meta = params._meta as NewSessionMeta | undefined;
    const injectedParams = this.applyLocalTools(
      this.applyStructuredOutput(
        {
          cwd: params.cwd,
          mcpServers: params.mcpServers ?? [],
          _meta: params._meta,
        },
        meta,
      ),
      meta,
    );

    // Create a new session via codex-acp (fork isn't natively supported)
    const newResponse = await this.codexConnection.newSession(injectedParams);
    newResponse.configOptions = normalizeCodexConfigOptions(
      newResponse.configOptions,
    );

    const requestedPermissionMode = toCodexPermissionMode(meta?.permissionMode);
    resetSessionState(this.sessionState, newResponse.sessionId, params.cwd, {
      taskRunId: meta?.taskRunId,
      taskId: resolveTaskId(meta),
      modeId: newResponse.modes?.currentModeId ?? "auto",
      permissionMode: requestedPermissionMode,
    });
    this.sessionId = newResponse.sessionId;
    this.sessionState.configOptions = newResponse.configOptions ?? [];
    this.sessionState.contextBreakdownBaseline = buildCodexBaseline(meta);

    await this.applyInitialPermissionMode(
      newResponse.sessionId,
      meta?.permissionMode,
      newResponse.modes?.currentModeId,
    );

    return newResponse;
  }

  /**
   * When the caller wires up `onStructuredOutput` and provides a JSON schema
   * via `_meta.jsonSchema`, inject the stdio MCP server that exposes
   * `create_output` and append instructions telling the model to use it.
   *
   * Codex has no native equivalent of Claude's `outputFormat`, so we lean on
   * MCP tool-calling to get validated structured output back.
   */
  private applyStructuredOutput<
    T extends { mcpServers?: McpServer[]; _meta?: unknown },
  >(request: T, meta: NewSessionMeta | undefined): T {
    if (!meta?.jsonSchema || !this.onStructuredOutput) {
      return request;
    }

    const mcpServer = buildStructuredOutputMcpServer(meta.jsonSchema);
    const existingMeta = (request._meta ?? {}) as Record<string, unknown>;
    const existingSystemPrompt =
      typeof existingMeta.systemPrompt === "string"
        ? existingMeta.systemPrompt
        : "";

    return {
      ...request,
      mcpServers: [...(request.mcpServers ?? []), mcpServer],
      _meta: {
        ...existingMeta,
        systemPrompt: existingSystemPrompt + STRUCTURED_OUTPUT_INSTRUCTIONS,
      },
    };
  }

  /**
   * Injects the stdio general local-tools MCP server. Tools self-gate via the
   * registry (e.g. signed-commit is cloud-only and needs a GH token), so the
   * server is only injected when at least one tool's gate passes. Their
   * instructions already live in the shared cloud system prompt, so only the
   * server needs injecting here.
   */
  private applyLocalTools<
    T extends { cwd?: string; mcpServers?: McpServer[]; _meta?: unknown },
  >(request: T, meta: NewSessionMeta | undefined): T {
    const cwd = request.cwd;
    if (!cwd) {
      return request;
    }
    const ctx: LocalToolCtx = {
      cwd,
      token: resolveGithubToken(),
      taskId: resolveTaskId(meta),
      baseBranch: meta?.baseBranch,
    };
    const tools = enabledLocalTools(ctx, meta);
    if (tools.length === 0) {
      if (isCloudRun(meta)) {
        this.logger.warn(
          "Cloud run registered no local tools — missing GH_TOKEN/GITHUB_TOKEN? signed commits unavailable",
        );
      }
      return request;
    }

    const mcpServer = buildLocalToolsMcpServer(
      ctx,
      tools.map((t) => t.name),
    );
    return {
      ...request,
      mcpServers: [...(request.mcpServers ?? []), mcpServer],
    };
  }

  private async applyInitialPermissionMode(
    sessionId: string,
    permissionMode?: string,
    currentModeId?: string,
  ): Promise<void> {
    if (!permissionMode) {
      return;
    }

    const nativeMode = toCodexNativeMode(permissionMode);
    if (nativeMode === currentModeId) {
      this.sessionState.modeId = nativeMode;
      this.sessionState.permissionMode = toCodexPermissionMode(permissionMode);
      return;
    }

    await this.codexConnection.setSessionMode({
      sessionId,
      modeId: nativeMode,
    });
    this.sessionState.modeId = nativeMode;
    this.sessionState.permissionMode = toCodexPermissionMode(permissionMode);
  }

  async listSessions(
    params: ListSessionsRequest,
  ): Promise<ListSessionsResponse> {
    return this.codexConnection.listSessions(params);
  }

  async unstable_listSessions(
    params: ListSessionsRequest,
  ): Promise<ListSessionsResponse> {
    return this.listSessions(params);
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const previous = this.promptMutex;
    const next = previous.catch(() => {}).then(() => this.runPrompt(params));
    this.promptMutex = next;
    return next;
  }

  private async runPrompt(params: PromptRequest): Promise<PromptResponse> {
    this.session.cancelled = false;
    this.session.interruptReason = undefined;
    resetUsage(this.sessionState);

    // codex-acp does not echo the user prompt back on the agent→client
    // channel, so without this broadcast the tapped stream (persisted to S3
    // and rendered by the PostHog web UI) never sees a user turn and only
    // the assistant reply shows up. Mirrors ClaudeAcpAgent.broadcastUserMessage.
    // The original params (no _meta.prContext prefix) is broadcast so the
    // injected PR context is not rendered as a user message.
    await this.broadcastUserMessage(params);

    this.session.promptRunning = true;
    let response: PromptResponse;
    try {
      response = await this.codexConnection.prompt(prependPrContext(params));
    } catch (error) {
      throw classifyPromptError(error);
    } finally {
      this.session.promptRunning = false;
    }

    // Usage is already accumulated via sessionUpdate notifications in
    // codex-client.ts. Do NOT also add response.usage here or tokens
    // get double-counted.

    if (this.sessionState.taskRunId) {
      const { accumulatedUsage } = this.sessionState;

      await this.client.extNotification(POSTHOG_NOTIFICATIONS.TURN_COMPLETE, {
        sessionId: params.sessionId,
        stopReason: response.stopReason ?? "end_turn",
        usage: {
          inputTokens: accumulatedUsage.inputTokens,
          outputTokens: accumulatedUsage.outputTokens,
          cachedReadTokens: accumulatedUsage.cachedReadTokens,
          cachedWriteTokens: accumulatedUsage.cachedWriteTokens,
          totalTokens:
            accumulatedUsage.inputTokens +
            accumulatedUsage.outputTokens +
            accumulatedUsage.cachedReadTokens +
            accumulatedUsage.cachedWriteTokens,
        },
      });

      if (response.usage) {
        await this.client.extNotification(POSTHOG_NOTIFICATIONS.USAGE_UPDATE, {
          sessionId: params.sessionId,
          used: {
            inputTokens: response.usage.inputTokens ?? 0,
            outputTokens: response.usage.outputTokens ?? 0,
            cachedReadTokens: response.usage.cachedReadTokens ?? 0,
            cachedWriteTokens: response.usage.cachedWriteTokens ?? 0,
          },
          cost: null,
        });
      }
    }

    // Emit the per-source breakdown so the renderer's ContextBreakdownPopover
    // has data to show. This fires regardless of `taskRunId` (local sessions
    // need it too) and regardless of `response.usage` (codex-acp doesn't
    // populate it — context size comes from upstream usage_update events,
    // tracked on sessionState.contextUsed).
    if (this.sessionState.contextUsed !== undefined) {
      await this.client.extNotification(POSTHOG_NOTIFICATIONS.USAGE_UPDATE, {
        sessionId: params.sessionId,
        breakdown: buildBreakdown(
          this.sessionState.contextBreakdownBaseline ?? emptyBaseline(),
          this.sessionState.contextUsed,
        ),
      });
    }

    return response;
  }

  protected async interrupt(): Promise<void> {
    await this.codexConnection.cancel({
      sessionId: this.sessionId,
    });
  }

  private async broadcastUserMessage(params: PromptRequest): Promise<void> {
    for (const chunk of params.prompt) {
      const notification = {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "user_message_chunk" as const,
          content: chunk,
        },
      };
      await this.client.sessionUpdate(notification);
      this.appendNotification(params.sessionId, notification);
    }
  }

  /**
   * Refresh the session between turns. Currently the only refreshable field
   * is `mcpServers`. Unlike Claude (where we rebuild an in-process Query with
   * `resume`), Codex runs as a `codex-acp` subprocess whose MCP set is bound
   * at `newSession`/`loadSession` time and whose user-local MCPs are disabled
   * via spawn-time `-c mcp_servers.<name>.enabled=false` CLI args. To
   * guarantee the caller-supplied set fully wins, we respawn the subprocess
   * and rehydrate the session via `loadSession` — codex-acp persists sessions
   * to disk, so conversation history is preserved.
   *
   * This is an `extMethod` (request/response), not `extNotification`, so the
   * caller can await completion before sending the next prompt.
   *
   * Caller contract: only call REFRESH_SESSION between turns (no prompt in flight).
   */
  async extMethod(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!isMethod(method, POSTHOG_METHODS.REFRESH_SESSION)) {
      throw RequestError.methodNotFound(method);
    }

    // Trust boundary: refresh is only safe when the caller is trusted infra
    // (e.g. the sandbox agent-server). Do not route this method from
    // untrusted clients — mcpServers contents are forwarded verbatim to
    // codex-acp with no URL/command validation.
    if (params.mcpServers === undefined) {
      throw new RequestError(
        -32602,
        "refresh_session requires at least one refreshable field (e.g. mcpServers)",
      );
    }
    if (!Array.isArray(params.mcpServers)) {
      throw new RequestError(
        -32602,
        "refresh_session: mcpServers must be an array",
      );
    }

    await this.refreshSession(params.mcpServers as McpServer[]);
    return { refreshed: true };
  }

  private async refreshSession(mcpServers: McpServer[]): Promise<void> {
    const prev = this.session;
    if (prev.promptRunning) {
      throw new RequestError(
        -32002,
        "Cannot refresh session while a prompt turn is in flight",
      );
    }

    this.logger.info("Refreshing Codex session with fresh MCP servers", {
      serverCount: mcpServers.length,
      sessionId: this.sessionId,
    });

    // Abort FIRST so any stuck in-flight ACP request unblocks — otherwise
    // cancel() can deadlock waiting on a codex-acp call that never returns.
    prev.abortController.abort();
    try {
      await this.codexConnection.cancel({ sessionId: this.sessionId });
    } catch (err) {
      this.logger.warn("cancel() during refresh failed (non-fatal)", {
        error: err,
      });
    }
    this.codexProcess.kill();

    // Respawn with the same options and a fresh settings manager rooted at
    // the current cwd (so the `mcp_servers.<name>.enabled=false` args are
    // regenerated from the latest ~/.codex/config.toml).
    const cwd = prev.settingsManager.getCwd();
    const newSettingsManager = new CodexSettingsManager(cwd);
    await newSettingsManager.initialize();

    const newProcess = spawnCodexProcess({
      ...this.codexProcessOptions,
      cwd,
      settings: newSettingsManager.getSettings(),
      logger: this.logger,
      processCallbacks: this.processCallbacks,
    });

    const codexReadable = nodeReadableToWebReadable(newProcess.stdout);
    const codexWritable = nodeWritableToWebWritable(newProcess.stdin);
    const codexStream = ndJsonStream(codexWritable, codexReadable);

    const newAbortController = new AbortController();
    const newConnection = new ClientSideConnection(
      (_agent) =>
        createCodexClient(this.client, this.logger, this.sessionState, {
          onStructuredOutput: this.onStructuredOutput,
        }),
      codexStream,
    );

    // Re-run ACP init on the new subprocess, then rehydrate the session with
    // the new MCP set. loadSession is codex-acp's equivalent of Claude's
    // `resume` — conversation history is restored from disk.
    const initRequest: InitializeRequest = this.lastInitRequest ?? {
      protocolVersion: 1,
    };
    await newConnection.initialize(initRequest);
    await newConnection.loadSession({
      sessionId: this.sessionId,
      cwd: this.sessionState.cwd,
      mcpServers,
    });

    // Swap everything at once so closeSession/prompt/cancel target the new
    // subprocess going forward. Preserve sessionState (accumulatedUsage,
    // taskRunId, configOptions) untouched.
    this.codexProcess = newProcess;
    this.codexConnection = newConnection;
    prev.settingsManager.dispose();
    prev.settingsManager = newSettingsManager;
    prev.abortController = newAbortController;
  }

  async setSessionMode(
    params: SetSessionModeRequest,
  ): Promise<SetSessionModeResponse> {
    const requestedMode = toCodexPermissionMode(params.modeId);
    const nativeMode = toCodexNativeMode(params.modeId);

    const response = await this.codexConnection.setSessionMode({
      ...params,
      modeId: nativeMode,
    });

    this.sessionState.modeId = nativeMode;
    this.sessionState.permissionMode = requestedMode;
    return response ?? {};
  }

  async setSessionConfigOption(
    params: SetSessionConfigOptionRequest,
  ): Promise<SetSessionConfigOptionResponse> {
    const response = await this.codexConnection.setSessionConfigOption(params);
    if (response.configOptions) {
      response.configOptions = normalizeCodexConfigOptions(
        response.configOptions,
      ) as typeof response.configOptions;
      this.sessionState.configOptions = response.configOptions;
    }
    if (params.configId === "mode" && typeof params.value === "string") {
      // Signal the mode change to agent-server so its session.permissionMode
      // cache (used by shouldRelayPermissionToClient) stays in sync with the
      // real Codex mode. Claude emits the same signal from its equivalent
      // handler; without it, the agent-server's relay decisions for cloud
      // runs would use a stale mode and silently auto-approve tool calls.
      await this.client.sessionUpdate({
        sessionId: this.sessionId,
        update: {
          sessionUpdate: "current_mode_update",
          currentModeId: params.value,
        },
      });
    }
    return response;
  }

  async authenticate(_params: AuthenticateRequest): Promise<void> {
    // Auth handled externally
  }

  async closeSession(): Promise<void> {
    this.logger.info("Closing Codex session", { sessionId: this.sessionId });
    this.session.abortController.abort();
    this.session.settingsManager.dispose();
    try {
      this.codexProcess.kill();
    } catch (err) {
      this.logger.warn("Failed to kill codex-acp process", { error: err });
    }
    this.enrichment?.dispose();
    this.enrichment = undefined;
  }
}
