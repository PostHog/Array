import fs, { mkdirSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  type Client,
  ClientSideConnection,
  type ContentBlock,
  ndJsonStream,
  PROTOCOL_VERSION,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import {
  isMcpToolReadOnly,
  isNotification,
  POSTHOG_NOTIFICATIONS,
} from "@posthog/agent";
import type { McpToolApprovals } from "@posthog/agent/adapters/claude/mcp/tool-metadata";
import { hydrateSessionJsonl } from "@posthog/agent/adapters/claude/session/jsonl-hydration";
import { getReasoningEffortOptions } from "@posthog/agent/adapters/reasoning-effort";
import { Agent } from "@posthog/agent/agent";
import {
  getAvailableCodexModes,
  getAvailableModes,
} from "@posthog/agent/execution-mode";
import {
  DEFAULT_CODEX_MODEL,
  DEFAULT_GATEWAY_MODEL,
  fetchGatewayModels,
  formatGatewayModelName,
  getProviderName,
  isAnthropicModel,
  isOpenAIModel,
} from "@posthog/agent/gateway-models";
import { getLlmGatewayUrl } from "@posthog/agent/posthog-api";
import { extractCreatedPrUrl } from "@posthog/agent/pr-url-detector";
import type * as AgentTypes from "@posthog/agent/types";
import { getCurrentBranch } from "@posthog/git/queries";
import type { IAppMeta } from "@posthog/platform/app-meta";
import type { IBundledResources } from "@posthog/platform/bundled-resources";
import type { IPowerManager } from "@posthog/platform/power-manager";
import type { IStoragePaths } from "@posthog/platform/storage-paths";
import { isAuthError } from "@shared/errors";
import type { AcpMessage } from "@shared/types/session-events";
import { inject, injectable, preDestroy } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { isDevBuild } from "../../utils/env";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import type { FsService } from "../fs/service";
import type { McpAppsService } from "../mcp-apps/service";
import type { PosthogPluginService } from "../posthog-plugin/service";
import type { ProcessTrackingService } from "../process-tracking/service";
import type { SleepService } from "../sleep/service";
import type { AgentAuthAdapter, McpToolInstallations } from "./auth-adapter";
import { discoverExternalPlugins } from "./discover-plugins";
import {
  AgentServiceEvent,
  type AgentServiceEvents,
  type Credentials,
  type EffortLevel,
  type InterruptReason,
  type PromptOutput,
  type ReconnectSessionInput,
  type SessionResponse,
  type StartSessionInput,
} from "./schemas";

export type { InterruptReason };

const log = logger.scope("agent-service");

const MOCK_NODE_DIR_PREFIX = "agent-node";

function getMockNodeDir(): string {
  const suffix = isDevBuild() ? "dev" : "prod";
  return join(tmpdir(), `${MOCK_NODE_DIR_PREFIX}-${suffix}`);
}

/** Mark all content blocks as hidden so the renderer doesn't show a duplicate user message on retry */
type MessageCallback = (message: unknown) => void;

/** Shape of the `_meta.claudeCode` extension field on tool call updates. */
interface ClaudeCodeToolMeta {
  claudeCode?: { toolName?: string };
}

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
      } catch (err) {
        // Stream may be closed if subprocess crashed - close gracefully
        log.warn("Stream read failed (subprocess may have crashed)", {
          error: err,
        });
        controller.close();
      }
    },
    cancel() {
      // Release the reader when stream is cancelled
      reader.releaseLock();
    },
  });
}

function createTappedWritableStream(
  underlying: WritableStream<Uint8Array>,
  onMessage: MessageCallback,
): WritableStream<Uint8Array> {
  const tap = new NdJsonTap(onMessage);

  return new WritableStream<Uint8Array>({
    async write(chunk) {
      tap.process(chunk);
      try {
        const writer = underlying.getWriter();
        await writer.write(chunk);
        writer.releaseLock();
      } catch (err) {
        // Stream may be closed if subprocess crashed - log but don't throw
        log.warn("Stream write failed (subprocess may have crashed)", {
          error: err,
        });
      }
    },
    async close() {
      try {
        const writer = underlying.getWriter();
        await writer.close();
        writer.releaseLock();
      } catch {
        // Stream may already be closed
      }
    },
    async abort(reason) {
      try {
        const writer = underlying.getWriter();
        await writer.abort(reason);
        writer.releaseLock();
      } catch {
        // Stream may already be closed
      }
    },
  });
}

const onAgentLog: AgentTypes.OnLogCallback = (level, scope, message, data) => {
  const scopedLog = logger.scope(scope);
  if (data !== undefined) {
    scopedLog[level as keyof typeof scopedLog](message, data);
  } else {
    scopedLog[level](message);
  }
};

function buildClaudeCodeOptions(args: {
  additionalDirectories?: string[];
  effort?: EffortLevel;
  plugins: { type: "local"; path: string }[];
}) {
  return {
    ...(args.additionalDirectories?.length && {
      additionalDirectories: args.additionalDirectories,
    }),
    ...(args.effort && { effort: args.effort }),
    plugins: args.plugins,
  };
}

interface SessionConfig {
  taskId: string;
  taskRunId: string;
  repoPath: string;
  credentials: Credentials;
  logUrl?: string;
  /** The agent's session ID (for resume - SDK session ID for Claude, Codex's session ID for Codex) */
  sessionId?: string;
  adapter?: "claude" | "codex";
  /** Additional directories Claude can access beyond cwd (for worktree support) */
  additionalDirectories?: string[];
  /** Permission mode to use for the session */
  permissionMode?: string;
  /** Custom instructions injected into the system prompt */
  customInstructions?: string;
  /** Effort level for Claude sessions */
  effort?: EffortLevel;
  /** Model to use for the session (e.g. "claude-sonnet-4-6") */
  model?: string;
  /** JSON Schema for structured task output — when set, the agent gets a create_output tool */
  jsonSchema?: Record<string, unknown> | null;
}

interface ManagedSession {
  taskRunId: string;
  taskId: string;
  repoPath: string;
  agent: Agent;
  clientSideConnection: ClientSideConnection;
  channel: string;
  createdAt: number;
  lastActivityAt: number;
  config: SessionConfig;
  interruptReason?: InterruptReason;
  promptPending: boolean;
  pendingContext?: string;
  configOptions?: SessionConfigOption[];
  /** Tracks in-flight MCP tool calls (toolCallId → toolKey) for cancellation */
  inFlightMcpToolCalls: Map<string, string>;
  /** MCP tool approval states fetched at session start */
  mcpToolApprovals: McpToolApprovals;
  /** Maps tool keys to their installation for backend approval updates */
  toolInstallations: McpToolInstallations;
}

/** Get the agent session ID from a managed session, throwing if not set. */
function getAgentSessionId(session: ManagedSession): string {
  const { sessionId } = session.config;
  if (!sessionId) {
    throw new Error(`Session ${session.taskRunId} has no agent session ID`);
  }
  return sessionId;
}

interface PendingPermission {
  resolve: (response: RequestPermissionResponse) => void;
  reject: (error: Error) => void;
  taskRunId: string;
  toolCallId: string;
}

@injectable()
export class AgentService extends TypedEventEmitter<AgentServiceEvents> {
  private static readonly IDLE_TIMEOUT_MS = 15 * 60 * 1000;

  private sessions = new Map<string, ManagedSession>();
  private pendingPermissions = new Map<string, PendingPermission>();
  private mockNodeReady = false;
  private idleTimeouts = new Map<
    string,
    { handle: ReturnType<typeof setTimeout>; deadline: number }
  >();
  private processTracking: ProcessTrackingService;
  private sleepService: SleepService;
  private fsService: FsService;
  private posthogPluginService: PosthogPluginService;
  private agentAuthAdapter: AgentAuthAdapter;
  private mcpAppsService: McpAppsService;

  constructor(
    @inject(MAIN_TOKENS.ProcessTrackingService)
    processTracking: ProcessTrackingService,
    @inject(MAIN_TOKENS.SleepService)
    sleepService: SleepService,
    @inject(MAIN_TOKENS.FsService)
    fsService: FsService,
    @inject(MAIN_TOKENS.PosthogPluginService)
    posthogPluginService: PosthogPluginService,
    @inject(MAIN_TOKENS.AgentAuthAdapter)
    agentAuthAdapter: AgentAuthAdapter,
    @inject(MAIN_TOKENS.McpAppsService)
    mcpAppsService: McpAppsService,
    @inject(MAIN_TOKENS.PowerManager)
    powerManager: IPowerManager,
    @inject(MAIN_TOKENS.BundledResources)
    private readonly bundledResources: IBundledResources,
    @inject(MAIN_TOKENS.AppMeta)
    private readonly appMeta: IAppMeta,
    @inject(MAIN_TOKENS.StoragePaths)
    private readonly storagePaths: IStoragePaths,
  ) {
    super();
    this.processTracking = processTracking;
    this.sleepService = sleepService;
    this.fsService = fsService;
    this.posthogPluginService = posthogPluginService;
    this.agentAuthAdapter = agentAuthAdapter;
    this.mcpAppsService = mcpAppsService;

    powerManager.onResume(() => this.checkIdleDeadlines());
  }

  private getClaudeCliPath(): string {
    return this.bundledResources.resolve(".vite/build/claude-cli/cli.js");
  }

  private getCodexBinaryPath(): string {
    return this.bundledResources.resolve(".vite/build/codex-acp/codex-acp");
  }

  /**
   * Respond to a pending permission request from the UI.
   * This resolves the promise that the agent is waiting on.
   */
  public respondToPermission(
    taskRunId: string,
    toolCallId: string,
    optionId: string,
    customInput?: string,
    answers?: Record<string, string>,
  ): void {
    const key = `${taskRunId}:${toolCallId}`;
    const pending = this.pendingPermissions.get(key);

    if (!pending) {
      log.warn("No pending permission found", { taskRunId, toolCallId });
      return;
    }

    log.info("Permission response received", {
      taskRunId,
      toolCallId,
      optionId,
      hasCustomInput: !!customInput,
      hasAnswers: !!answers,
    });

    const meta: Record<string, unknown> = {};
    if (customInput) meta.customInput = customInput;
    if (answers) meta.answers = answers;

    pending.resolve({
      outcome: {
        outcome: "selected",
        optionId,
      },
      ...(Object.keys(meta).length > 0 && { _meta: meta }),
    });

    this.pendingPermissions.delete(key);
    this.recordActivity(taskRunId);
  }

  /**
   * Cancel a pending permission request.
   * This resolves the promise with a "cancelled" outcome per ACP spec.
   */
  public cancelPermission(taskRunId: string, toolCallId: string): void {
    const key = `${taskRunId}:${toolCallId}`;
    const pending = this.pendingPermissions.get(key);

    if (!pending) {
      log.warn("No pending permission found to cancel", {
        taskRunId,
        toolCallId,
      });
      return;
    }

    log.info("Permission cancelled", { taskRunId, toolCallId });

    pending.resolve({
      outcome: {
        outcome: "cancelled",
      },
    });

    this.pendingPermissions.delete(key);
    this.recordActivity(taskRunId);
  }

  /**
   * Check if any sessions are currently active (i.e. have a prompt pending).
   */
  public hasActiveSessions(): boolean {
    for (const session of this.sessions.values()) {
      if (session.promptPending || session.inFlightMcpToolCalls.size > 0) {
        return true;
      }
    }
    return false;
  }

  public recordActivity(taskRunId: string): void {
    if (!this.sessions.has(taskRunId)) return;

    const existing = this.idleTimeouts.get(taskRunId);
    if (existing) clearTimeout(existing.handle);

    const deadline = Date.now() + AgentService.IDLE_TIMEOUT_MS;
    const handle = setTimeout(() => {
      this.killIdleSession(taskRunId);
    }, AgentService.IDLE_TIMEOUT_MS);

    this.idleTimeouts.set(taskRunId, { handle, deadline });
  }

  private killIdleSession(taskRunId: string): void {
    const session = this.sessions.get(taskRunId);
    if (!session) return;
    if (session.promptPending || session.inFlightMcpToolCalls.size > 0) {
      this.recordActivity(taskRunId);
      return;
    }
    log.info("Killing idle session", { taskRunId, taskId: session.taskId });
    this.emit(AgentServiceEvent.SessionIdleKilled, {
      taskRunId,
      taskId: session.taskId,
    });
    this.cleanupSession(taskRunId).catch((err) => {
      log.error("Failed to cleanup idle session", { taskRunId, err });
    });
  }

  private checkIdleDeadlines(): void {
    const now = Date.now();
    const expired = [...this.idleTimeouts.entries()].filter(
      ([, { deadline }]) => now >= deadline,
    );
    for (const [taskRunId, { handle }] of expired) {
      clearTimeout(handle);
      this.killIdleSession(taskRunId);
    }
  }

  private buildSystemPrompt(
    credentials: Credentials,
    taskId: string,
    customInstructions?: string,
  ): {
    append: string;
  } {
    let prompt = `PostHog context: use project ${credentials.projectId} on ${credentials.apiHost}. When using PostHog MCP tools, operate only on this project.`;

    prompt += `

## Attribution
Do NOT use Claude Code's default attribution (no "Co-Authored-By" trailers, no "Generated with [Claude Code]" lines).

Instead, add the following trailers to EVERY commit message (after a blank line at the end):
  Generated-By: PostHog Code
  Task-Id: ${taskId}

Example:
\`\`\`
git commit -m "$(cat <<'EOF'
fix: resolve login redirect loop

Generated-By: PostHog Code
Task-Id: ${taskId}
EOF
)"
\`\`\`

When creating new branches, prefix them with \`posthog-code/\` (e.g. \`posthog-code/fix-login-redirect\`).

When creating pull requests, add the following footer at the end of the PR description:
\`\`\`
---
*Created with [PostHog Code](https://posthog.com/code?ref=pr)*
\`\`\``;

    if (customInstructions) {
      prompt += `\n\nUser custom instructions:\n${customInstructions}`;
    }

    return { append: prompt };
  }

  async startSession(params: StartSessionInput): Promise<SessionResponse> {
    this.validateSessionParams(params);
    const config = this.toSessionConfig(params);
    const session = await this.getOrCreateSession(config, false);
    if (!session) {
      throw new Error("Failed to create session");
    }
    return this.toSessionResponse(session);
  }

  async reconnectSession(
    params: ReconnectSessionInput,
  ): Promise<SessionResponse | null> {
    try {
      this.validateSessionParams(params);
    } catch (err) {
      log.error("Invalid reconnect params", err);
      return null;
    }

    const config = this.toSessionConfig(params);
    const session = await this.getOrCreateSession(config, true);
    return session ? this.toSessionResponse(session) : null;
  }

  private async getOrCreateSession(
    config: SessionConfig,
    isReconnect: boolean,
    isRetry = false,
  ): Promise<ManagedSession | null> {
    const {
      taskId,
      taskRunId,
      repoPath: rawRepoPath,
      credentials,
      logUrl,
      adapter,
      additionalDirectories,
      permissionMode,
      customInstructions,
      effort,
      model,
      jsonSchema,
    } = config;

    // Preview config doesn't need a real repo — use a temp directory
    const repoPath = taskId === "__preview__" ? tmpdir() : rawRepoPath;

    if (!isRetry) {
      const existing = this.sessions.get(taskRunId);
      if (existing) {
        return existing;
      }

      for (const proc of this.processTracking.getByTaskId(taskId)) {
        if (
          (proc.category === "agent" || proc.category === "child") &&
          proc.metadata?.taskRunId === taskRunId
        ) {
          this.processTracking.kill(proc.pid);
        }
      }

      // Clean up any prior session for this taskRunId before creating a new one
      await this.cleanupSession(taskRunId);
    }

    const channel = `agent-event:${taskRunId}`;
    const mockNodeDir = this.setupMockNodeEnvironment();
    const proxyUrl = await this.agentAuthAdapter.ensureGatewayProxy(
      credentials.apiHost,
    );
    await this.agentAuthAdapter.configureProcessEnv({
      credentials,
      mockNodeDir,
      proxyUrl,
      claudeCliPath: this.getClaudeCliPath(),
    });

    const isPreview = taskId === "__preview__";

    const agent = new Agent({
      posthog: {
        ...this.agentAuthAdapter.createPosthogConfig(credentials),
        userAgent: `posthog/desktop.hog.dev; version: ${this.appMeta.version}`,
      },
      skipLogPersistence: isPreview,
      localCachePath: join(homedir(), ".posthog-code"),
      debug: isDevBuild(),
      onLog: onAgentLog,
    });

    try {
      const systemPrompt = this.buildSystemPrompt(
        credentials,
        taskId,
        customInstructions,
      );

      const acpConnection = await agent.run(taskId, taskRunId, {
        adapter,
        gatewayUrl: proxyUrl,
        codexBinaryPath:
          adapter === "codex" ? this.getCodexBinaryPath() : undefined,
        model,
        instructions: adapter === "codex" ? systemPrompt.append : undefined,
        onStructuredOutput: jsonSchema
          ? async (output) => {
              const posthogAPI = agent.getPosthogAPI();
              if (posthogAPI) {
                await posthogAPI.updateTaskRun(taskId, taskRunId, { output });
              }
            }
          : undefined,
        processCallbacks: {
          onProcessSpawned: (info) => {
            this.processTracking.register(
              info.pid,
              "agent",
              `agent:${taskRunId}`,
              {
                taskRunId,
                taskId,
                command: info.command,
              },
              taskId,
            );
          },
          onProcessExited: (pid) => {
            this.processTracking.unregister(pid, "agent-exited");
          },
          onMcpServersReady: (serverNames) => {
            this.mcpAppsService.handleDiscovery(serverNames).catch((err) => {
              log.warn("MCP Apps discovery failed", {
                error: err instanceof Error ? err.message : String(err),
              });
            });
          },
        },
      });
      const { clientStreams } = acpConnection;

      const connection = this.createClientConnection(
        taskRunId,
        channel,
        clientStreams,
      );

      await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
          terminal: true,
        },
      });

      const {
        servers: mcpServers,
        toolApprovals,
        toolInstallations,
      } = await this.agentAuthAdapter.buildMcpServers(credentials);

      // Store server configs for lazy MCP connections — actual connections
      // are created on-demand when UI resources are first requested.
      this.mcpAppsService.setServerConfigs(
        mcpServers.map((s) => ({
          name: s.name,
          url: s.url,
          headers: Object.fromEntries(s.headers.map((h) => [h.name, h.value])),
        })),
      );

      let externalPlugins: Awaited<ReturnType<typeof discoverExternalPlugins>> =
        [];
      try {
        externalPlugins = await discoverExternalPlugins({
          userDataDir: this.storagePaths.appDataPath,
          repoPath,
        });
      } catch (err) {
        log.warn("Failed to discover external plugins", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      const plugins = [
        {
          type: "local" as const,
          path: this.posthogPluginService.getPluginPath(),
        },
        ...externalPlugins,
      ];
      const claudeCodeOptions = buildClaudeCodeOptions({
        additionalDirectories,
        effort,
        plugins,
      });

      let configOptions: SessionConfigOption[] | undefined;
      let agentSessionId: string;

      // Claude-specific: hydrate session JSONL from PostHog before resuming.
      // If hydration finds no conversation to restore, skip the resume and
      // fall through to creating a new session. This avoids a doomed
      // unstable_resumeSession that would fail with "Resource not found"
      if (isReconnect && config.sessionId) {
        const existingSessionId = config.sessionId;

        if (adapter !== "codex") {
          const posthogAPI = agent.getPosthogAPI();
          if (posthogAPI) {
            const hasSession = await hydrateSessionJsonl({
              sessionId: existingSessionId,
              cwd: repoPath,
              taskId,
              runId: taskRunId,
              permissionMode: config.permissionMode,
              posthogAPI,
              log,
            });
            if (!hasSession) {
              log.info(
                "No session JSONL to resume, creating new session instead",
                { taskId, taskRunId },
              );
              config.sessionId = undefined;
            }
          }
        }
      }

      if (isReconnect && config.sessionId) {
        const existingSessionId = config.sessionId;

        // Both adapters implement unstable_resumeSession:
        // - Claude: delegates to SDK's resumeSession with JSONL hydration
        // - Codex: delegates to codex-acp's loadSession internally
        const resumeResponse = await connection.unstable_resumeSession({
          sessionId: existingSessionId,
          cwd: repoPath,
          mcpServers,
          _meta: {
            ...(logUrl && {
              persistence: { taskId, runId: taskRunId, logUrl },
            }),
            taskRunId,
            sessionId: existingSessionId,
            systemPrompt,
            mcpToolApprovals: toolApprovals,
            ...(permissionMode && { permissionMode }),
            ...(model != null && { model }),
            ...(jsonSchema && { jsonSchema }),
            claudeCode: {
              options: claudeCodeOptions,
            },
          },
        });
        configOptions = resumeResponse?.configOptions ?? undefined;
        agentSessionId = existingSessionId;
      } else {
        if (isReconnect) {
          log.info("No sessionId for reconnect, creating new session", {
            taskId,
            taskRunId,
          });
        }
        const newSessionResponse = await connection.newSession({
          cwd: repoPath,
          mcpServers,
          _meta: {
            taskRunId,
            systemPrompt,
            mcpToolApprovals: toolApprovals,
            ...(permissionMode && { permissionMode }),
            ...(model != null && { model }),
            ...(jsonSchema && { jsonSchema }),
            claudeCode: {
              options: claudeCodeOptions,
            },
          },
        });
        configOptions = newSessionResponse.configOptions ?? undefined;
        agentSessionId = newSessionResponse.sessionId;
      }

      config.sessionId = agentSessionId;

      const session: ManagedSession = {
        taskRunId,
        taskId,
        repoPath,
        agent,
        clientSideConnection: connection,
        channel,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        config,
        promptPending: false,
        configOptions,
        inFlightMcpToolCalls: new Map(),
        mcpToolApprovals: toolApprovals,
        toolInstallations,
      };

      this.sessions.set(taskRunId, session);
      this.recordActivity(taskRunId);

      if (isRetry) {
        log.info("Session created after auth retry", { taskRunId });
      }
      return session;
    } catch (err) {
      try {
        await agent.cleanup();
      } catch {
        log.debug("Agent cleanup failed during error handling", { taskRunId });
      }

      if (!isRetry && isAuthError(err)) {
        log.warn(
          `Auth error during ${isReconnect ? "reconnect" : "create"}, retrying`,
          { taskRunId },
        );
        return this.getOrCreateSession(config, isReconnect, true);
      }
      log.error(
        `Failed to ${isReconnect ? "reconnect" : "create"} session${
          isRetry ? " after retry" : ""
        }`,
        err,
      );
      // Non-auth reconnect failure on first attempt: fall back to a fresh session.
      // If this was already an auth retry (isRetry=true), we've exhausted retries
      // and return null to avoid infinite loops.
      if (isReconnect && !isRetry) {
        log.warn("Reconnect failed, falling back to new session", {
          taskRunId,
        });
        config.sessionId = undefined;
        return this.getOrCreateSession(config, false, false);
      }
      if (isReconnect) return null;
      throw err;
    }
  }

  async prompt(
    sessionId: string,
    prompt: ContentBlock[],
  ): Promise<PromptOutput> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Prepend pending context if present
    let finalPrompt = prompt;
    if (session.pendingContext) {
      log.info("Prepending context to prompt", { sessionId });
      finalPrompt = [
        {
          type: "text",
          text: `_${session.pendingContext}_\n\n`,
          _meta: { ui: { hidden: true } },
        },
        ...prompt,
      ];
      session.pendingContext = undefined;
    }

    session.lastActivityAt = Date.now();
    session.promptPending = true;
    this.recordActivity(sessionId);
    this.sleepService.acquire(sessionId);

    try {
      const result = await session.clientSideConnection.prompt({
        sessionId: getAgentSessionId(session),
        prompt: finalPrompt,
      });
      return {
        stopReason: result.stopReason,
        _meta: result._meta as PromptOutput["_meta"],
      };
    } finally {
      session.promptPending = false;
      session.lastActivityAt = Date.now();
      this.recordActivity(sessionId);
      this.sleepService.release(sessionId);

      if (!this.hasActiveSessions()) {
        this.emit(AgentServiceEvent.SessionsIdle, undefined);
      }
    }
  }

  async cancelSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    try {
      await this.cleanupSession(sessionId);
      return true;
    } catch (_err) {
      return false;
    }
  }

  async cancelSessionsByTaskId(taskId: string): Promise<void> {
    for (const [taskRunId, session] of this.sessions) {
      if (session.taskId === taskId) {
        await this.cleanupSession(taskRunId);
      }
    }
  }

  async cancelPrompt(
    sessionId: string,
    reason?: InterruptReason,
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    try {
      this.cancelInFlightMcpToolCalls(session);
      await session.clientSideConnection.cancel({
        sessionId: getAgentSessionId(session),
        _meta: reason ? { interruptReason: reason } : undefined,
      });
      if (reason) {
        session.interruptReason = reason;
        log.info("Session interrupted", { sessionId, reason });
      }
      return true;
    } catch (err) {
      log.error("Failed to cancel prompt", { sessionId, err });
      return false;
    }
  }

  getSession(taskRunId: string): ManagedSession | undefined {
    return this.sessions.get(taskRunId);
  }

  async setSessionConfigOption(
    sessionId: string,
    configId: string,
    value: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    try {
      const result = await session.clientSideConnection.setSessionConfigOption({
        sessionId: getAgentSessionId(session),
        configId,
        value,
      });
      session.configOptions = result.configOptions ?? session.configOptions;

      const updatedModeOption = session.configOptions?.find(
        (opt) => opt.category === "mode",
      );
      if (
        updatedModeOption &&
        typeof updatedModeOption.currentValue === "string"
      ) {
        session.config.permissionMode = updatedModeOption.currentValue;
      }
    } catch (err) {
      log.error("Failed to set session config option", {
        sessionId,
        configId,
        value,
        err,
      });
      throw err;
    }
  }

  listSessions(taskId?: string): ManagedSession[] {
    const all = Array.from(this.sessions.values());
    return taskId ? all.filter((s) => s.taskId === taskId) : all;
  }

  /**
   * Get sessions that were interrupted for a specific reason.
   * Optionally filter by repoPath to get only sessions for a specific repo.
   */
  getInterruptedSessions(
    reason: InterruptReason,
    repoPath?: string,
  ): ManagedSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) =>
        s.interruptReason === reason &&
        (repoPath === undefined || s.repoPath === repoPath),
    );
  }

  /**
   * Resume an interrupted session by clearing the interrupt reason
   * and sending a continue prompt.
   */
  async resumeInterruptedSession(sessionId: string): Promise<PromptOutput> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (!session.interruptReason) {
      throw new Error(`Session ${sessionId} was not interrupted`);
    }
    log.info("Resuming interrupted session", {
      sessionId,
      reason: session.interruptReason,
    });
    // Clear the interrupt reason
    session.interruptReason = undefined;
    // Send a continue prompt
    return this.prompt(sessionId, [
      { type: "text", text: "Continue where you left off." },
    ]);
  }

  setPendingContext(taskRunId: string, context: string): void {
    const session = this.sessions.get(taskRunId);
    if (!session) {
      log.warn("Session not found for setPendingContext", { taskRunId });
      return;
    }
    session.pendingContext = context;
    log.info("Set pending context on session", {
      taskRunId,
      contextLength: context.length,
    });
  }

  /**
   * Notify a session of a context change (CWD moved, detached HEAD, etc).
   * Used when focusing/unfocusing worktrees - the agent doesn't need to respawn
   * because it has additionalDirectories configured, but it should know about the change.
   */
  async notifySessionContext(
    sessionId: string,
    context: import("./schemas.js").SessionContextChange,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      log.warn("Session not found for context notification", { sessionId });
      return;
    }

    const contextMessage = this.buildContextMessage(context);

    // Check if session is currently busy
    if (session.promptPending) {
      // Active session: send immediately with continue instruction
      this.prompt(sessionId, [
        {
          type: "text",
          text: `${contextMessage} Continue where you left off.`,
          _meta: { ui: { hidden: true } },
        },
      ]);
    } else {
      // Idle session: store for prepending to next user message
      session.pendingContext = contextMessage;
    }

    log.info("Notified session of context change", {
      sessionId,
      context,
      wasPromptPending: session.promptPending,
    });
  }

  private buildContextMessage(
    context: import("./schemas.js").SessionContextChange,
  ): string {
    if (context.isDetached) {
      return `Your worktree is now on detached HEAD while the user edits in their main repo. The branch is \`${context.branchName}\`.

For git operations while detached:
- Commit: works normally
- Push: \`git push origin HEAD:refs/heads/${context.branchName}\`
- Pull: \`git fetch origin ${context.branchName} && git merge FETCH_HEAD\``;
    }
    return `Your worktree is back on branch \`${context.branchName}\`. Normal git commands work again.`;
  }

  @preDestroy()
  async cleanupAll(): Promise<void> {
    for (const { handle } of this.idleTimeouts.values()) clearTimeout(handle);
    this.idleTimeouts.clear();
    const sessionIds = Array.from(this.sessions.keys());
    log.info("Cleaning up all agent sessions", {
      sessionCount: sessionIds.length,
    });

    for (const session of this.sessions.values()) {
      try {
        await session.agent.flushAllLogs();
      } catch {
        log.debug("Failed to flush session logs during shutdown");
      }
    }

    for (const taskRunId of sessionIds) {
      await this.cleanupSession(taskRunId);
    }

    log.info("All agent sessions cleaned up");
  }

  private setupMockNodeEnvironment(): string {
    const mockNodeDir = getMockNodeDir();
    if (!this.mockNodeReady) {
      try {
        mkdirSync(mockNodeDir, { recursive: true });
        const nodeSymlinkPath = join(mockNodeDir, "node");
        try {
          symlinkSync(process.execPath, nodeSymlinkPath);
        } catch (err) {
          if (
            !(err instanceof Error) ||
            !("code" in err) ||
            err.code !== "EEXIST"
          ) {
            throw err;
          }
        }
        this.mockNodeReady = true;
      } catch (err) {
        log.warn("Failed to setup mock node environment", err);
      }
    }
    return mockNodeDir;
  }

  private cancelInFlightMcpToolCalls(session: ManagedSession): void {
    for (const [toolCallId, toolKey] of session.inFlightMcpToolCalls) {
      this.mcpAppsService.notifyToolCancelled(toolKey, toolCallId);
    }

    session.inFlightMcpToolCalls.clear();
  }

  private async cleanupSession(taskRunId: string): Promise<void> {
    const session = this.sessions.get(taskRunId);
    if (session) {
      this.cancelInFlightMcpToolCalls(session);
      this.sleepService.release(taskRunId);
      try {
        await session.agent.cleanup();
      } catch {
        log.debug("Agent cleanup failed", { taskRunId });
      }

      this.sessions.delete(taskRunId);

      const timeout = this.idleTimeouts.get(taskRunId);
      if (timeout) {
        clearTimeout(timeout.handle);
        this.idleTimeouts.delete(taskRunId);
      }

      // When no sessions remain, tear down MCP Apps connections and cached resources
      if (this.sessions.size === 0) {
        this.mcpAppsService.cleanup().catch(() => {
          log.debug("MCP Apps cleanup failed");
        });
      }
    }
  }

  private createClientConnection(
    taskRunId: string,
    _channel: string,
    clientStreams: { readable: ReadableStream; writable: WritableStream },
  ): ClientSideConnection {
    // Capture service reference for use in client callbacks
    const service = this;

    const emitToRenderer = (payload: unknown) => {
      // Emit event via TypedEventEmitter for tRPC subscription
      this.emit(AgentServiceEvent.SessionEvent, {
        taskRunId,
        payload,
      });
    };

    const onAcpMessage = (message: unknown) => {
      const acpMessage: AcpMessage = {
        type: "acp_message",
        ts: Date.now(),
        message: message as AcpMessage["message"],
      };
      emitToRenderer(acpMessage);

      // Inspect tool call updates for PR URLs and file activity
      this.handleToolCallUpdate(taskRunId, message as AcpMessage["message"]);
    };

    const tappedReadable = createTappedReadableStream(
      clientStreams.readable as ReadableStream<Uint8Array>,
      onAcpMessage,
    );

    const tappedWritable = createTappedWritableStream(
      clientStreams.writable as WritableStream<Uint8Array>,
      onAcpMessage,
    );

    const client: Client = {
      async requestPermission(
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> {
        const toolName =
          (params.toolCall?.rawInput as { toolName?: string } | undefined)
            ?.toolName || "";
        const toolCallId = params.toolCall?.toolCallId || "";

        log.info("requestPermission called", {
          taskRunId,
          toolCallId,
          toolName,
          title: params.toolCall?.title,
          optionCount: params.options.length,
        });

        if (toolName && isMcpToolReadOnly(toolName)) {
          const session = service.sessions.get(taskRunId);
          const approvalState = session?.mcpToolApprovals?.[toolName];
          if (approvalState === "approved") {
            log.info("Auto-approving read-only MCP tool", {
              taskRunId,
              toolName,
            });
            const allowOption = params.options.find(
              (o) => o.kind === "allow_once" || o.kind === "allow_always",
            );
            return {
              outcome: {
                outcome: "selected",
                optionId: allowOption?.optionId ?? params.options[0].optionId,
              },
            };
          }
        }

        // If we have a toolCallId, always prompt the user for permission.
        // The claude.ts adapter only calls requestPermission when user input is needed.
        // (It handles auto-approve internally for acceptEdits/bypassPermissions modes)
        if (toolCallId) {
          service.sleepService.release(taskRunId);
          try {
            const response = await new Promise<RequestPermissionResponse>(
              (resolve, reject) => {
                const key = `${taskRunId}:${toolCallId}`;
                service.pendingPermissions.set(key, {
                  resolve,
                  reject,
                  taskRunId,
                  toolCallId,
                });

                log.info("Emitting permission request to renderer", {
                  taskRunId,
                  toolCallId,
                });
                const { sessionId: _agentSessionId, ...rest } = params;
                service.emit(AgentServiceEvent.PermissionRequest, {
                  ...rest,
                  taskRunId,
                });
              },
            );

            const approved =
              response.outcome?.outcome === "selected" &&
              (response.outcome.optionId === "allow" ||
                response.outcome.optionId === "allow_always");
            if (approved && toolName) {
              const session = service.sessions.get(taskRunId);
              if (
                session?.mcpToolApprovals?.[toolName] === "needs_approval" &&
                session.toolInstallations[toolName]
              ) {
                const { installationId, toolName: rawToolName } =
                  session.toolInstallations[toolName];
                try {
                  await service.agentAuthAdapter.updateMcpToolApproval(
                    session.config.credentials,
                    installationId,
                    rawToolName,
                    "approved",
                  );
                  session.mcpToolApprovals[toolName] = "approved";
                } catch (err) {
                  log.warn("Failed to update tool approval on backend", {
                    toolName,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
            }

            return response;
          } finally {
            // Only re-acquire if session wasn't cleaned up while waiting
            if (service.sessions.has(taskRunId)) {
              service.sleepService.acquire(taskRunId);
            }
          }
        }

        // Fallback: no toolCallId means we can't track the response, auto-approve
        log.warn("No toolCallId in permission request, auto-approving", {
          taskRunId,
          toolName,
        });
        const allowOption = params.options.find(
          (o) => o.kind === "allow_once" || o.kind === "allow_always",
        );
        return {
          outcome: {
            outcome: "selected",
            optionId: allowOption?.optionId ?? params.options[0].optionId,
          },
        };
      },

      async readTextFile(params) {
        const session = service.sessions.get(taskRunId);
        if (!session) {
          throw new Error(`No active session for taskRunId=${taskRunId}`);
        }
        const repoPath = session.config.repoPath;
        const relativePath = service.toRepoRelativePath(repoPath, params.path);
        const content = await service.fsService.readRepoFile(
          repoPath,
          relativePath,
        );
        if (content === null) {
          throw new Error(`File not found: ${params.path}`);
        }
        return { content };
      },

      async writeTextFile(params) {
        const session = service.sessions.get(taskRunId);
        if (!session) {
          throw new Error(`No active session for taskRunId=${taskRunId}`);
        }
        const repoPath = session.config.repoPath;
        const relativePath = service.toRepoRelativePath(repoPath, params.path);
        await service.fsService.writeRepoFile(
          repoPath,
          relativePath,
          params.content,
        );
        return {};
      },

      async sessionUpdate(params: SessionNotification) {
        // Forward MCP tool events to McpAppsService using the SDK's
        // typed discriminated union instead of parsing raw JSON.
        const { update } = params;
        if (
          update.sessionUpdate !== "tool_call" &&
          update.sessionUpdate !== "tool_call_update"
        ) {
          return;
        }

        const toolName = (update._meta as ClaudeCodeToolMeta | undefined)
          ?.claudeCode?.toolName;
        if (!toolName?.startsWith("mcp__")) return;

        const session = service.sessions.get(taskRunId);
        if (update.sessionUpdate === "tool_call") {
          session?.inFlightMcpToolCalls.set(update.toolCallId, toolName);
          service.mcpAppsService.notifyToolInput(
            toolName,
            update.toolCallId,
            update.rawInput,
          );
        } else if (
          update.status === "completed" ||
          update.status === "failed"
        ) {
          session?.inFlightMcpToolCalls.delete(update.toolCallId);
          service.mcpAppsService.notifyToolResult(
            toolName,
            update.toolCallId,
            update.rawOutput,
            update.status === "failed",
          );
        }
      },

      extNotification: async (
        method: string,
        params: Record<string, unknown>,
      ): Promise<void> => {
        if (isNotification(method, POSTHOG_NOTIFICATIONS.SDK_SESSION)) {
          const {
            taskRunId: notifTaskRunId,
            sessionId,
            adapter: notifAdapter,
          } = params as {
            taskRunId: string;
            sessionId: string;
            adapter: "claude" | "codex";
          };
          const session = this.sessions.get(notifTaskRunId);
          if (session) {
            session.config.sessionId = sessionId;
            if (notifAdapter) {
              session.config.adapter = notifAdapter;
            }
            log.info("Session ID captured", {
              taskRunId: notifTaskRunId,
              sessionId,
              adapter: notifAdapter,
            });
          }
        }

        // Extension notifications already flow through the tapped stream
        // (same pattern as sessionUpdate). No need to re-emit here.
      },
    };

    const clientStream = ndJsonStream(tappedWritable, tappedReadable);

    return new ClientSideConnection((_agent) => client, clientStream);
  }

  private validateSessionParams(
    params: StartSessionInput | ReconnectSessionInput,
  ): void {
    if (!params.taskId || !params.repoPath) {
      throw new Error("taskId and repoPath are required");
    }
    if (!params.apiHost) {
      throw new Error("PostHog API host is required");
    }
  }

  private toRepoRelativePath(repoPath: string, filePath: string): string {
    const normalize = (inputPath: string): string => {
      try {
        return fs.realpathSync(inputPath);
      } catch {
        return resolve(inputPath);
      }
    };

    const resolvedRepo = normalize(repoPath);
    const resolvedFile = isAbsolute(filePath)
      ? resolve(filePath)
      : resolve(repoPath, filePath);
    const resolvedFileForCheck = fs.existsSync(resolvedFile)
      ? normalize(resolvedFile)
      : resolve(resolvedFile);
    const repoPrefix = resolvedRepo.endsWith(sep)
      ? resolvedRepo
      : `${resolvedRepo}${sep}`;

    if (
      resolvedFileForCheck === resolvedRepo ||
      !resolvedFileForCheck.startsWith(repoPrefix)
    ) {
      throw new Error(`Access denied: path outside repository (${filePath})`);
    }

    return relative(resolvedRepo, resolvedFileForCheck);
  }

  private toSessionConfig(
    params: StartSessionInput | ReconnectSessionInput,
  ): SessionConfig {
    return {
      taskId: params.taskId,
      taskRunId: params.taskRunId,
      repoPath: params.repoPath,
      credentials: {
        apiHost: params.apiHost,
        projectId: params.projectId,
      },
      logUrl: "logUrl" in params ? params.logUrl : undefined,
      sessionId: "sessionId" in params ? params.sessionId : undefined,
      adapter: "adapter" in params ? params.adapter : undefined,
      additionalDirectories:
        "additionalDirectories" in params
          ? params.additionalDirectories
          : undefined,
      permissionMode:
        "permissionMode" in params ? params.permissionMode : undefined,
      customInstructions:
        "customInstructions" in params ? params.customInstructions : undefined,
      effort: "effort" in params ? params.effort : undefined,
      model: "model" in params ? params.model : undefined,
      jsonSchema: "jsonSchema" in params ? params.jsonSchema : undefined,
    };
  }

  private toSessionResponse(session: ManagedSession): SessionResponse {
    return {
      sessionId: session.taskRunId,
      channel: session.channel,
      configOptions: session.configOptions,
    };
  }

  private handleToolCallUpdate(taskRunId: string, message: unknown): void {
    try {
      const msg = message as {
        method?: string;
        params?: {
          update?: {
            sessionUpdate?: string;
            _meta?: {
              claudeCode?: {
                toolName?: string;
                toolResponse?: unknown;
                bashCommand?: string;
              };
            };
            content?: Array<{ type?: string; text?: string }>;
          };
        };
      };

      // Only process session/update notifications for tool_call_update
      if (msg.method !== "session/update") return;
      if (msg.params?.update?.sessionUpdate !== "tool_call_update") return;

      const update = msg.params.update;
      const toolMeta = update._meta?.claudeCode;
      const toolName = toolMeta?.toolName;
      if (!toolName) return;

      const session = this.sessions.get(taskRunId);

      this.detectAndAttachPrUrl(taskRunId, session, toolMeta, update.content);

      this.trackAgentFileActivity(taskRunId, session, toolName);
    } catch (err) {
      log.debug("Error in tool call update handling", {
        taskRunId,
        error: err,
      });
    }
  }

  /**
   * Detect GitHub PR URLs in `gh pr create` output and attach to task.
   * Gated on the originating bash command so that unrelated PR URLs (e.g.
   * `gh pr view`, `gh search prs`) don't get latched onto the run.
   */
  private detectAndAttachPrUrl(
    taskRunId: string,
    session: ManagedSession | undefined,
    toolMeta:
      | {
          toolName?: string;
          toolResponse?: unknown;
          bashCommand?: string;
        }
      | undefined,
    content?: Array<{ type?: string; text?: string }>,
  ): void {
    const prUrl = extractCreatedPrUrl({
      toolName: toolMeta?.toolName,
      bashCommand: toolMeta?.bashCommand,
      toolResponse: toolMeta?.toolResponse,
      content,
    });
    if (!prUrl) return;

    log.info("Detected PR URL from gh pr create", { taskRunId, prUrl });

    if (!session) {
      log.warn("Session not found for PR attachment", { taskRunId });
      return;
    }

    session.agent
      .attachPullRequestToTask(session.taskId, prUrl)
      .then(() => {
        log.info("PR URL attached to task", {
          taskRunId,
          taskId: session.taskId,
          prUrl,
        });
      })
      .catch((err) => {
        log.error("Failed to attach PR URL to task", {
          taskRunId,
          taskId: session.taskId,
          prUrl,
          error: err,
        });
      });

    // The user-initiated PR-creation flow links the current branch to the
    // workspace atomically (see GitService.createPr). PRs created via bash —
    // e.g. an agent running a `/commit-and-pr` skill — never go through that
    // flow, so `workspace.linkedBranch` would otherwise stay unset and
    // PR-aware UI (the unified PR badge, branch mismatch warning, diff
    // source) would have no anchor. Emit AgentFileActivity here too so
    // WorkspaceService.handleAgentFileActivity links the current feature
    // branch the moment we observe a PR for it.
    this.emitAgentFileActivityForCurrentBranch(taskRunId, session, {
      reason: "pr-detected",
    });
  }

  /**
   * Track agent file activity for branch association observability.
   */
  private static readonly FILE_MODIFYING_TOOLS = new Set([
    "Edit",
    "Write",
    "FileEditTool",
    "FileWriteTool",
    "MultiEdit",
    "NotebookEdit",
  ]);

  private trackAgentFileActivity(
    taskRunId: string,
    session: ManagedSession | undefined,
    toolName: string,
  ): void {
    if (!session) return;
    if (!AgentService.FILE_MODIFYING_TOOLS.has(toolName)) return;

    this.emitAgentFileActivityForCurrentBranch(taskRunId, session, {
      reason: "file-edit",
      toolName,
    });
  }

  /**
   * Resolve the current branch in the session's repo and emit AgentFileActivity
   * so WorkspaceService can link the branch to the task. Best-effort — branch
   * resolution failures are logged but never thrown.
   */
  private emitAgentFileActivityForCurrentBranch(
    taskRunId: string,
    session: ManagedSession,
    context: { reason: "file-edit" | "pr-detected"; toolName?: string },
  ): void {
    getCurrentBranch(session.repoPath)
      .then((branchName) => {
        this.emit(AgentServiceEvent.AgentFileActivity, {
          taskId: session.taskId,
          branchName,
        });
      })
      .catch((err) => {
        log.warn("Failed to emit agent file activity event", {
          taskRunId,
          taskId: session.taskId,
          ...context,
          error: err,
        });
      });
  }

  async getGatewayModels(apiHost: string) {
    const gatewayUrl = getLlmGatewayUrl(apiHost);
    const models = await fetchGatewayModels({ gatewayUrl });

    const mapped = models.map((model) => ({
      modelId: model.id,
      name: formatGatewayModelName(model),
      description: `Context: ${model.context_window.toLocaleString()} tokens`,
      provider: getProviderName(model.owned_by),
    }));

    const CLAUDE_TIER_ORDER = ["opus", "sonnet", "haiku"];
    const getModelTier = (modelId: string): number => {
      const lowerId = modelId.toLowerCase();
      for (let i = 0; i < CLAUDE_TIER_ORDER.length; i++) {
        if (lowerId.includes(CLAUDE_TIER_ORDER[i])) return i;
      }
      return CLAUDE_TIER_ORDER.length;
    };

    return mapped.sort((a, b) => {
      const providerOrder = ["Anthropic", "OpenAI", "Gemini"];
      const aProviderIdx = providerOrder.indexOf(a.provider ?? "");
      const bProviderIdx = providerOrder.indexOf(b.provider ?? "");
      if (aProviderIdx !== bProviderIdx) {
        const aIdx = aProviderIdx === -1 ? 999 : aProviderIdx;
        const bIdx = bProviderIdx === -1 ? 999 : bProviderIdx;
        return aIdx - bIdx;
      }
      return getModelTier(a.modelId) - getModelTier(b.modelId);
    });
  }

  async getPreviewConfigOptions(
    apiHost: string,
    adapter: "claude" | "codex" = "claude",
  ): Promise<SessionConfigOption[]> {
    const gatewayUrl = getLlmGatewayUrl(apiHost);
    const gatewayModels = await fetchGatewayModels({ gatewayUrl });

    const modelFilter = adapter === "codex" ? isOpenAIModel : isAnthropicModel;

    const modelOptions = gatewayModels
      .filter((model) => modelFilter(model))
      .map((model) => ({
        value: model.id,
        name: formatGatewayModelName(model),
        description: `Context: ${model.context_window.toLocaleString()} tokens`,
      }));

    const defaultModel =
      adapter === "codex"
        ? (modelOptions.find((o) => o.value === DEFAULT_CODEX_MODEL)?.value ??
          modelOptions[0]?.value ??
          "")
        : DEFAULT_GATEWAY_MODEL;

    const resolvedModelId = modelOptions.some((o) => o.value === defaultModel)
      ? defaultModel
      : (modelOptions[0]?.value ?? defaultModel);

    if (!modelOptions.some((o) => o.value === resolvedModelId)) {
      modelOptions.unshift({
        value: resolvedModelId,
        name: resolvedModelId,
        description: "Custom model",
      });
    }

    const modes =
      adapter === "codex" ? getAvailableCodexModes() : getAvailableModes();
    const modeOptions = modes.map((mode) => ({
      value: mode.id,
      name: mode.name,
      description: mode.description ?? undefined,
    }));
    const defaultMode = adapter === "codex" ? "auto" : "plan";

    const configOptions: SessionConfigOption[] = [
      {
        id: "mode",
        name: "Approval Preset",
        type: "select",
        currentValue: defaultMode,
        options: modeOptions,
        category: "mode",
        description:
          "Choose an approval and sandboxing preset for your session",
      },
      {
        id: "model",
        name: "Model",
        type: "select",
        currentValue: resolvedModelId,
        options: modelOptions,
        category: "model",
        description: "Choose which model Claude should use",
      },
    ];

    const effortOpts = getReasoningEffortOptions(adapter, resolvedModelId);
    if (effortOpts) {
      configOptions.push({
        id: adapter === "codex" ? "reasoning_effort" : "effort",
        name: adapter === "codex" ? "Reasoning Level" : "Effort",
        type: "select",
        currentValue: "high",
        options: effortOpts,
        category: "thought_level",
        description:
          adapter === "codex"
            ? "Controls how much reasoning effort the model uses"
            : "Controls how much effort Claude puts into its response",
      });
    }

    return configOptions;
  }
}
