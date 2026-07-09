import fs, { promises as fsPromises, mkdirSync, symlinkSync } from "node:fs";
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
import {
  getSessionJsonlPath,
  hydrateSessionJsonl,
} from "@posthog/agent/adapters/claude/session/jsonl-hydration";
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
  type GatewayModel,
  getClaudeModelRecency,
  getProviderName,
  isAnthropicModel,
  isCloudflareModel,
  isOpenAIModel,
} from "@posthog/agent/gateway-models";
import { getLlmGatewayUrl } from "@posthog/agent/posthog-api";
import { findPrUrl, wasCreatedRecently } from "@posthog/agent/pr-url-detector";
import {
  formatConversationForResume,
  resumeFromLog,
} from "@posthog/agent/resume";
import type * as AgentTypes from "@posthog/agent/types";
import { execGh } from "@posthog/git/gh";
import { getCurrentBranch } from "@posthog/git/queries";
import { CaptureCheckpointSaga } from "@posthog/git/sagas/checkpoint";
import { APP_META_SERVICE, type IAppMeta } from "@posthog/platform/app-meta";
import {
  BUNDLED_RESOURCES_SERVICE,
  type IBundledResources,
} from "@posthog/platform/bundled-resources";
import {
  type IPowerManager,
  POWER_MANAGER_SERVICE,
} from "@posthog/platform/power-manager";
import {
  type IStoragePaths,
  STORAGE_PATHS_SERVICE,
} from "@posthog/platform/storage-paths";
import {
  type IWorkspaceSettings,
  WORKSPACE_SETTINGS_SERVICE,
} from "@posthog/platform/workspace-settings";
import {
  type AcpMessage,
  isAuthError,
  serializeError,
  TypedEventEmitter,
} from "@posthog/shared";
import { inject, injectable, preDestroy } from "inversify";
import { WORKSPACE_REPOSITORY } from "../../db/identifiers";
import type { IWorkspaceRepository } from "../../db/repositories/workspace-repository";
import type { FoldersService } from "../folders/folders";
import { FOLDERS_SERVICE } from "../folders/identifiers";
import type { RegisteredFolder } from "../folders/schemas";
import { POSTHOG_PLUGIN_SERVICE } from "../posthog-plugin/identifiers";
import type { PosthogPluginService } from "../posthog-plugin/posthog-plugin";
import { PROCESS_TRACKING_SERVICE } from "../process-tracking/identifiers";
import type { ProcessTrackingService } from "../process-tracking/process-tracking";
import { loadSessionEnvOverrides } from "../session-env/loader";
import { isScratchPath } from "../workspace/scratch";
import type { AgentAuthAdapter, McpToolInstallations } from "./auth-adapter";
import { cleanupCodexHome, prepareCodexHome } from "./codex-home";
import { discoverExternalPlugins } from "./discover-plugins";
import {
  AGENT_AUTH_ADAPTER,
  AGENT_LOGGER,
  AGENT_MCP_APPS,
  AGENT_REPO_FILES,
  AGENT_SLEEP_COORDINATOR,
} from "./identifiers";
import type {
  AgentLogger,
  AgentMcpApps,
  AgentRepoFiles,
  AgentScopedLogger,
  AgentSleepCoordinator,
} from "./ports";
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

function isDevBuild(): boolean {
  return process.env.POSTHOG_CODE_IS_DEV === "true";
}

const MOCK_NODE_DIR_PREFIX = "agent-node";
const DATA_DIR = ".posthog-code";

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
  log: AgentScopedLogger,
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
  log: AgentScopedLogger,
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

function makeOnAgentLog(loggerFactory: AgentLogger): AgentTypes.OnLogCallback {
  return (level, scope, message, data) => {
    const scopedLog = loggerFactory.scope(scope);
    if (data !== undefined) {
      scopedLog[level as keyof AgentScopedLogger](message, data);
    } else {
      scopedLog[level as keyof AgentScopedLogger](message);
    }
  };
}

function buildClaudeCodeOptions(args: {
  additionalDirectories?: string[];
  effort?: EffortLevel;
  plugins: { type: "local"; path: string }[];
  disallowedTools?: string[];
}) {
  return {
    ...(args.additionalDirectories?.length && {
      additionalDirectories: args.additionalDirectories,
    }),
    ...(args.effort && { effort: args.effort }),
    ...(args.disallowedTools?.length && {
      disallowedTools: args.disallowedTools,
    }),
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
  /** Permission mode to use for the session */
  permissionMode?: string;
  /** Custom instructions injected into the system prompt */
  customInstructions?: string;
  /** Replaces the PostHog system prompt entirely (constrained surfaces). */
  systemPromptOverride?: string;
  /** Tool names denied for this session (passed to the Claude SDK). */
  disallowedTools?: string[];
  /** Effort level for Claude sessions */
  effort?: EffortLevel;
  /** Model to use for the session (e.g. "claude-sonnet-4-6") */
  model?: string;
  /** JSON Schema for structured task output — when set, the agent gets a create_output tool */
  jsonSchema?: Record<string, unknown> | null;
  /**
   * Session ID of an imported Claude Code CLI transcript already present in
   * CLAUDE_CONFIG_DIR. Starts the session via loadSession so prior history is
   * replayed to the client. Claude adapter only.
   */
  importedSessionId?: string;
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
  // Reset per session. `evaluatedPrUrls` dedupes the GitHub lookup per URL.
  prAttributed: boolean;
  evaluatedPrUrls: Set<string>;
}

/** Get the agent session ID from a managed session, throwing if not set. */
function getAgentSessionId(session: ManagedSession): string {
  const { sessionId } = session.config;
  if (!sessionId) {
    throw new Error(`Session ${session.taskRunId} has no agent session ID`);
  }
  return sessionId;
}

export function buildAutoApproveOutcome(
  options: RequestPermissionRequest["options"],
): RequestPermissionResponse["outcome"] {
  const allowOption = options.find(
    (o) => o.kind === "allow_once" || o.kind === "allow_always",
  );
  const optionId = allowOption?.optionId ?? options[0]?.optionId;
  if (!optionId) {
    return { outcome: "cancelled" };
  }
  return { outcome: "selected", optionId };
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
  /** taskRunIds that need force-refetch of JSONL on next reconnect (checkpoint restore). */
  private checkpointRestoreTaskRunIds = new Set<string>();
  /** Checkpoint notifications captured per taskRunId, in capture order. Survives session reconnect. */
  private sessionCheckpoints = new Map<
    string,
    Array<{
      checkpointId: string;
      ts: number;
      promptId: number | undefined;
      /**
       * ISO-8601 time the TURN completed (when TURN_COMPLETE fired), NOT when the
       * async git snapshot finished. The snapshot can take minutes on a large repo,
       * so `ts`/the emitted-marker timestamp land well after later turns' prompts —
       * making them useless as a truncation boundary. This is the true turn boundary
       * used to trim the restore-truncated log. Optional: cloud-registered checkpoints
       * and pre-fix logs don't carry it (callers fall back to the marker timestamp).
       */
      turnCompletedAt?: string;
    }>
  >();
  private mockNodeReady = false;
  private idleTimeouts = new Map<
    string,
    { handle: ReturnType<typeof setTimeout>; deadline: number }
  >();
  private processTracking: ProcessTrackingService;
  private sleepService: AgentSleepCoordinator;
  private fsService: AgentRepoFiles;
  private posthogPluginService: PosthogPluginService;
  private agentAuthAdapter: AgentAuthAdapter;
  private mcpAppsService: AgentMcpApps;
  private readonly log: AgentScopedLogger;
  private readonly onAgentLog: AgentTypes.OnLogCallback;

  constructor(
    @inject(PROCESS_TRACKING_SERVICE)
    processTracking: ProcessTrackingService,
    @inject(AGENT_SLEEP_COORDINATOR)
    sleepService: AgentSleepCoordinator,
    @inject(AGENT_REPO_FILES)
    fsService: AgentRepoFiles,
    @inject(POSTHOG_PLUGIN_SERVICE)
    posthogPluginService: PosthogPluginService,
    @inject(AGENT_AUTH_ADAPTER)
    agentAuthAdapter: AgentAuthAdapter,
    @inject(AGENT_MCP_APPS)
    mcpAppsService: AgentMcpApps,
    @inject(POWER_MANAGER_SERVICE)
    powerManager: IPowerManager,
    @inject(BUNDLED_RESOURCES_SERVICE)
    private readonly bundledResources: IBundledResources,
    @inject(APP_META_SERVICE)
    private readonly appMeta: IAppMeta,
    @inject(STORAGE_PATHS_SERVICE)
    private readonly storagePaths: IStoragePaths,
    @inject(WORKSPACE_REPOSITORY)
    private readonly workspaceRepository: IWorkspaceRepository,
    @inject(WORKSPACE_SETTINGS_SERVICE)
    private readonly workspaceSettings: IWorkspaceSettings,
    @inject(FOLDERS_SERVICE)
    private readonly foldersService: FoldersService,
    @inject(AGENT_LOGGER)
    loggerFactory: AgentLogger,
  ) {
    super();
    this.processTracking = processTracking;
    this.sleepService = sleepService;
    this.fsService = fsService;
    this.posthogPluginService = posthogPluginService;
    this.agentAuthAdapter = agentAuthAdapter;
    this.mcpAppsService = mcpAppsService;
    this.log = loggerFactory.scope("agent-service");
    this.onAgentLog = makeOnAgentLog(loggerFactory);

    powerManager.onResume(() => this.checkIdleDeadlines());
  }

  private getClaudeCliPath(): string {
    // Keep in sync with the destDir in apps/code/vite-main-plugins.mts
    // (copyClaudeExecutable plugin).
    const binary = process.platform === "win32" ? "claude.exe" : "claude";
    return this.bundledResources.resolve(`.vite/build/claude-cli/${binary}`);
  }

  private getCodexBinaryPath(): string {
    const binary = process.platform === "win32" ? "codex-acp.exe" : "codex-acp";
    return this.bundledResources.resolve(`.vite/build/codex-acp/${binary}`);
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
      this.log.warn("No pending permission found", { taskRunId, toolCallId });
      return;
    }

    this.log.info("Permission response received", {
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
      this.log.warn("No pending permission found to cancel", {
        taskRunId,
        toolCallId,
      });
      return;
    }

    this.log.info("Permission cancelled", { taskRunId, toolCallId });

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
    this.log.info("Killing idle session", {
      taskRunId,
      taskId: session.taskId,
    });
    this.emit(AgentServiceEvent.SessionIdleKilled, {
      taskRunId,
      taskId: session.taskId,
    });
    this.cleanupSession(taskRunId).catch((err) => {
      this.log.error("Failed to cleanup idle session", { taskRunId, err });
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
    additionalDirectories?: string[],
    systemPromptOverride?: string,
    channelMode?: boolean,
    knownLocalFolders?: RegisteredFolder[],
  ): {
    append: string;
  } {
    // A constrained surface (e.g. the canvas generator) supplies its own prompt
    // and does NOT want the default coding/attribution guidance.
    if (systemPromptOverride) {
      return { append: systemPromptOverride };
    }

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

    if (channelMode) {
      const localFolders = (knownLocalFolders ?? []).filter(
        (f) => f.exists !== false,
      );
      const localFoldersBlock = localFolders.length
        ? `\n\nThe user already has these repositories checked out locally on this machine. Prefer reusing one of these over cloning anything:\n${localFolders
            .map(
              (f) =>
                `  - ${f.name} — ${f.path}${f.remoteUrl ? ` (${f.remoteUrl})` : ""}`,
            )
            .join("\n")}`
        : "";

      prompt += `

## Channel task (no repository attached)
You are running in a PostHog channel as a general-purpose assistant. This task may NOT need a code repository at all — it could be data analysis via PostHog tools, drafting a message, or answering a question. Do not assume you need a repo.

- Your working directory is a scratch directory, not a git checkout. Treat it as empty.
- Decide from the user's request (and the channel CONTEXT.md included above, if any) whether the task actually requires working inside a code repository. If it doesn't, just do the work in the scratch directory — do NOT attach a repo.

If a repository IS genuinely required, attach one in this priority order:
1. **Reuse a folder the user already has locally.** ${localFolders.length ? "Pick the one that best matches the request and the channel CONTEXT.md, then `cd` into its absolute path and do all git and file work there. It is already on disk — do NOT clone it again." : "If the user names a folder or path, `cd` into that absolute path and work there."}
2. **If you can't confidently pick one** (none clearly match, or it's ambiguous), use the AskUserQuestion tool to ask the user which local folder to use, or for the path where the folder lives on this machine. Do not guess.
3. **Only as a last resort** — when the user has no local copy, or explicitly wants a fresh checkout — clone from remote. Call \`list_repos\` to see what's available (prefer repos named in CONTEXT.md), then **confirm with the user via AskUserQuestion before cloning**, and use \`clone_repo\` (pass \`owner/repo\`); it clones into a subdirectory of your working directory and returns the path to \`cd\` into.${localFoldersBlock}`;
    }

    if (customInstructions) {
      prompt += `\n\nUser custom instructions:\n${customInstructions}`;
    }

    if (additionalDirectories?.length) {
      const escapeXml = (s: string) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const dirs = additionalDirectories
        .map((d) => `  <directory>${escapeXml(d)}</directory>`)
        .join("\n");
      prompt += `\n\nThe user has granted you access to additional directories outside the working directory. You may read and edit files in these paths just like the working directory:\n<additional_directories>\n${dirs}\n</additional_directories>`;
    }

    return { append: prompt };
  }

  async startSession(params: StartSessionInput): Promise<SessionResponse> {
    this.validateSessionParams(params);
    const config = this.toSessionConfig(params);
    const session = await this.getOrCreateSession(config, false);
    return this.toSessionResponse(session);
  }

  async reconnectSession(
    params: ReconnectSessionInput,
  ): Promise<SessionResponse | null> {
    try {
      this.validateSessionParams(params);
    } catch (err) {
      this.log.error("Invalid reconnect params", err);
      return null;
    }

    const config = this.toSessionConfig(params);
    const session = await this.getOrCreateSession(config, true);
    return session ? this.toSessionResponse(session) : null;
  }

  private async getOrCreateSession(
    config: SessionConfig,
    isReconnect: false,
    isRetry?: boolean,
  ): Promise<ManagedSession>;
  private async getOrCreateSession(
    config: SessionConfig,
    isReconnect: true,
    isRetry?: boolean,
  ): Promise<ManagedSession | null>;
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
      permissionMode,
      customInstructions,
      systemPromptOverride,
      disallowedTools,
      effort,
      model,
      jsonSchema,
    } = config;

    // Preview config doesn't need a real repo — use a temp directory
    const repoPath = taskId === "__preview__" ? tmpdir() : rawRepoPath;

    // Repo-less channel tasks run in a scratch dir. Detecting it server-side
    // (rather than plumbing a flag from the client) keeps channel mode correct
    // across reconnects, where the same scratch repoPath is passed back in.
    const channelMode = isScratchPath(
      repoPath,
      this.workspaceSettings.getWorktreeLocation(),
    );

    // In channel mode the agent decides at runtime whether it needs a repo. Give
    // it the user's previously-used local folders so it can reuse one (or ask)
    // instead of cloning from remote. Only fetched for channel sessions.
    const knownLocalFolders = channelMode
      ? await this.foldersService.getFolders().catch(() => [])
      : [];

    const additionalDirectories =
      taskId === "__preview__"
        ? []
        : this.workspaceRepository.getAdditionalDirectories(taskId);

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
      onLog: this.onAgentLog,
    });

    try {
      const systemPrompt = this.buildSystemPrompt(
        credentials,
        taskId,
        customInstructions,
        additionalDirectories,
        systemPromptOverride,
        channelMode,
        knownLocalFolders,
      );

      const bundledSkillsDir = join(
        this.posthogPluginService.getPluginPath(),
        "skills",
      );

      let codexHome: string | undefined;
      if (adapter === "codex") {
        try {
          codexHome = await prepareCodexHome({
            appDataPath: this.storagePaths.appDataPath,
            taskRunId,
            bundledSkillsDir,
            log: this.log,
          });
        } catch (err) {
          // A skills-prep failure must not kill the session; Codex falls back
          // to its default home and the user's own ~/.agents/skills.
          this.log.warn("Failed to prepare codex home", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const acpConnection = await agent.run(taskId, taskRunId, {
        adapter,
        gatewayUrl: proxyUrl,
        codexBinaryPath:
          adapter === "codex" ? this.getCodexBinaryPath() : undefined,
        codexHome,
        model,
        reasoningEffort: adapter === "codex" ? effort : undefined,
        developerInstructions:
          adapter === "codex" ? systemPrompt.append : undefined,
        additionalDirectories:
          adapter === "codex" ? additionalDirectories : undefined,
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
              this.log.warn("MCP Apps discovery failed", {
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

      // codex-acp connects to every MCP server eagerly during session creation
      // and treats an unreachable one as fatal, which kills the session
      // ("ACP connection closed") and makes the host silently fall back to a
      // Claude/Opus session. Claude connects lazily and is unaffected, so only
      // the Codex server list is pruned to the reachable ones.
      const sessionMcpServers =
        adapter === "codex"
          ? await this.filterReachableMcpServers(mcpServers, taskRunId)
          : mcpServers;

      let externalPlugins: Awaited<ReturnType<typeof discoverExternalPlugins>> =
        [];
      try {
        externalPlugins = await discoverExternalPlugins(
          {
            userDataDir: this.storagePaths.appDataPath,
            repoPath,
            bundledSkillsDir,
          },
          this.log,
        );
      } catch (err) {
        this.log.warn("Failed to discover external plugins", {
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
        disallowedTools,
      });

      let configOptions: SessionConfigOption[] | undefined;
      let agentSessionId: string | undefined;
      // Bounded context summary injected on a codex checkpoint-restore reconnect
      // (see the codex branch below). Applied to the fresh session's pendingContext.
      let codexRestorePendingContext: string | undefined;

      // Imported Claude Code CLI session: the transcript JSONL was copied
      // into CLAUDE_CONFIG_DIR at import time, so load it directly and let
      // the adapter replay its history to the client. On failure, fall
      // through to a fresh session so the task still starts.
      if (!isReconnect && config.importedSessionId && adapter !== "codex") {
        const importedSessionId = config.importedSessionId;
        try {
          const loadResponse = await connection.loadSession({
            sessionId: importedSessionId,
            cwd: repoPath,
            mcpServers: sessionMcpServers,
            _meta: {
              ...(logUrl && {
                persistence: { taskId, runId: taskRunId, logUrl },
              }),
              taskRunId,
              environment: "local",
              sessionId: importedSessionId,
              systemPrompt,
              ...(channelMode && { channelMode }),
              mcpToolApprovals: toolApprovals,
              ...(permissionMode && { permissionMode }),
              ...(model != null && { model }),
              ...(jsonSchema && { jsonSchema }),
              claudeCode: {
                options: claudeCodeOptions,
              },
            },
          });
          configOptions = loadResponse?.configOptions ?? undefined;
          agentSessionId = importedSessionId;
        } catch (err) {
          this.log.warn(
            "Failed to load imported session, creating new session instead",
            {
              taskId,
              taskRunId,
              error: err instanceof Error ? err.message : String(err),
            },
          );
        }
      }

      // Claude-specific: hydrate session JSONL from PostHog before resuming.
      // If hydration finds no conversation to restore, skip the resume and
      // fall through to creating a new session. This avoids a doomed
      // resumeSession that would fail with "Resource not found"
      if (isReconnect && config.sessionId) {
        const existingSessionId = config.sessionId;

        if (adapter !== "codex") {
          const posthogAPI = agent.getPosthogAPI();
          if (posthogAPI) {
            const forceRefetch =
              this.checkpointRestoreTaskRunIds.has(taskRunId);
            if (forceRefetch) {
              this.checkpointRestoreTaskRunIds.delete(taskRunId);
            }
            const hasSession = await hydrateSessionJsonl({
              sessionId: existingSessionId,
              cwd: repoPath,
              taskId,
              runId: taskRunId,
              permissionMode: config.permissionMode,
              posthogAPI,
              log: this.log,
              forceRefetch,
            });
            if (!hasSession) {
              this.log.info(
                "No session JSONL to resume, creating new session instead",
                { taskId, taskRunId },
              );
              config.sessionId = undefined;
            }
          }
        } else if (this.checkpointRestoreTaskRunIds.has(taskRunId)) {
          // Codex checkpoint restore. Codex has no JSONL hydration, so resuming the
          // existing rollout would keep two things the agent must forget: the handoff
          // context-summary turn (the entire pre-restore conversation embedded as
          // text) and any post-checkpoint turns. Turn-level rollout truncation can't
          // strip history baked into a surviving summary turn. So mirror what handoff
          // (and Claude hydration) do: start a FRESH session and inject a context
          // summary of the conversation UP TO the checkpoint, rebuilt from the
          // already-truncated S3 log (runRestore truncates S3 before cancelSession
          // triggers this reconnect).
          this.checkpointRestoreTaskRunIds.delete(taskRunId);
          const posthogAPI = agent.getPosthogAPI();
          if (posthogAPI) {
            try {
              const { conversation } = await resumeFromLog({
                taskId,
                runId: taskRunId,
                apiClient: posthogAPI,
              });
              const summary = formatConversationForResume(conversation);
              if (summary.trim()) {
                // Phrasing includes resume-context markers so a later handoff/restore
                // rebuild recognises and strips this turn (formatConversationForResume
                // → isResumeContextTurn), preventing nested summaries.
                codexRestorePendingContext =
                  `You are resuming a previous conversation after the workspace was ` +
                  `restored to an earlier checkpoint. The files have been reverted to ` +
                  `that checkpoint. Here is the conversation history from the session ` +
                  `up to that point:\n\n${summary}\n\n` +
                  `Continue from where the conversation left off.`;
              }
            } catch (err) {
              this.log.warn(
                "Failed to rebuild codex context after checkpoint restore",
                {
                  taskId,
                  taskRunId,
                  error: err instanceof Error ? err.message : String(err),
                },
              );
            }
          }
          // Abandon the stale rollout regardless: a fresh session with the bounded
          // summary above is the only way to drop the embedded pre-checkpoint history.
          config.sessionId = undefined;
        }
      }

      if (isReconnect && config.sessionId) {
        const existingSessionId = config.sessionId;
        this.log.info("Reconnecting with existing sessionId", {
          taskId,
          taskRunId,
          sessionId: existingSessionId,
        });

        // Both adapters implement resumeSession:
        // - Claude: delegates to SDK's resumeSession with JSONL hydration
        // - Codex: delegates to codex-acp's loadSession internally
        const resumeResponse = await connection.resumeSession({
          sessionId: existingSessionId,
          cwd: repoPath,
          mcpServers: sessionMcpServers,
          _meta: {
            ...(logUrl && {
              persistence: { taskId, runId: taskRunId, logUrl },
            }),
            taskRunId,
            environment: "local",
            sessionId: existingSessionId,
            systemPrompt,
            ...(channelMode && { channelMode }),
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
      } else if (agentSessionId === undefined) {
        if (isReconnect) {
          this.log.info("No sessionId for reconnect, creating new session", {
            taskId,
            taskRunId,
          });
        }
        const newSessionResponse = await connection.newSession({
          cwd: repoPath,
          mcpServers: sessionMcpServers,
          _meta: {
            taskRunId,
            environment: "local",
            systemPrompt,
            ...(channelMode && { channelMode }),
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
        // Set on a codex checkpoint-restore reconnect: bounded conversation summary
        // prepended to the next prompt so the fresh session's memory ends at the
        // restored checkpoint (undefined for every other reconnect/create path).
        pendingContext: codexRestorePendingContext,
        prAttributed: false,
        evaluatedPrUrls: new Set(),
      };

      this.sessions.set(taskRunId, session);
      this.recordActivity(taskRunId);

      if (isRetry) {
        this.log.info("Session created after auth retry", { taskRunId });
      }
      return session;
    } catch (err) {
      try {
        await agent.cleanup();
      } catch {
        this.log.debug("Agent cleanup failed during error handling", {
          taskRunId,
        });
      }

      if (!isRetry && isAuthError(err)) {
        this.log.warn(
          `Auth error during ${isReconnect ? "reconnect" : "create"}, retrying`,
          { taskRunId },
        );
        if (isReconnect) {
          return this.getOrCreateSession(config, true, true);
        }
        return this.getOrCreateSession(config, false, true);
      }
      // When the in-process ACP layer masks a thrown error as a generic
      // "Internal error", the real text survives in `data.details`. Surface it
      // here (host-side, before the tRPC boundary drops `data`) so the exported
      // log names the actual cause.
      const maskedDetail = (err as { data?: { details?: unknown } })?.data
        ?.details;
      const detailSuffix =
        typeof maskedDetail === "string" && maskedDetail
          ? `: ${maskedDetail}`
          : "";
      const action = isReconnect ? "reconnect" : "create";
      this.log.error(
        `Failed to ${action} session${isRetry ? " after retry" : ""}${detailSuffix}`,
        {
          taskRunId,
          taskId,
          sessionId: config.sessionId,
          adapter: config.adapter,
          model: config.model,
          isRetry,
          data: (err as { data?: unknown }).data,
          errorDetail: serializeError(err),
        },
      );
      // Non-auth reconnect failure on first attempt: fall back to a fresh session.
      // If this was already an auth retry (isRetry=true), we've exhausted retries
      // and return null to avoid infinite loops.
      if (isReconnect && !isRetry) {
        this.log.warn("Reconnect failed, falling back to new session", {
          taskRunId,
          taskId,
          sessionId: config.sessionId,
        });
        config.sessionId = undefined;
        return this.getOrCreateSession(config, false, false);
      }
      if (isReconnect) return null;
      throw err;
    }
  }

  private async filterReachableMcpServers<
    T extends {
      name: string;
      url: string;
      headers: Array<{ name: string; value: string }>;
    },
  >(servers: T[], taskRunId: string): Promise<T[]> {
    const probed = await Promise.all(
      servers.map(async (server) => ({
        server,
        reachable: await this.isMcpServerReachable(server),
      })),
    );
    const reachable: T[] = [];
    for (const { server, reachable: ok } of probed) {
      if (ok) {
        reachable.push(server);
      } else {
        this.log.warn(
          "Dropping unreachable MCP server from Codex session; codex-acp treats an unreachable server as a fatal startup error",
          { taskRunId, server: server.name, url: server.url },
        );
      }
    }
    return reachable;
  }

  private async isMcpServerReachable(server: {
    url: string;
    headers: Array<{ name: string; value: string }>;
  }): Promise<boolean> {
    const PROBE_TIMEOUT_MS = 2_000;
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      };
      for (const header of server.headers) {
        headers[header.name] = header.value;
      }
      const response = await fetch(server.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "posthog-code", version: "1.0.0" },
          },
        }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      // Release the body without draining it. A cancel rejection (e.g. an
      // already-disturbed stream) is a cleanup detail, not a reachability
      // signal, so it must not flip the result to unreachable.
      try {
        await response.body?.cancel();
      } catch {
        // ignore body cleanup failures
      }
      // Any HTTP response means the endpoint is reachable. codex-acp only treats
      // transport failures (connection refused, DNS, timeout) as fatal; HTTP or
      // JSON-RPC error responses are handled gracefully.
      return true;
    } catch (err) {
      this.log.debug("MCP server reachability probe failed", {
        url: server.url,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async prompt(
    sessionId: string,
    prompt: ContentBlock[],
    options?: { steer?: boolean },
  ): Promise<PromptOutput> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // A steer is injected into the turn that is already running, which owns the
    // promptPending/sleep/idle lifecycle. Forward it fire-and-forget so this
    // call does not flip that shared state out from under the live turn.
    if (options?.steer) {
      const result = await session.clientSideConnection.prompt({
        sessionId: getAgentSessionId(session),
        prompt,
        _meta: { steer: true },
      });
      return {
        stopReason: result.stopReason,
        _meta: result._meta as PromptOutput["_meta"],
      };
    }

    // Prepend pending context if present
    let finalPrompt = prompt;
    if (session.pendingContext) {
      this.log.info("Prepending context to prompt", { sessionId });
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
        this.log.info("Session interrupted", { sessionId, reason });
      }
      return true;
    } catch (err) {
      this.log.error("Failed to cancel prompt", { sessionId, err });
      return false;
    }
  }

  getSession(taskRunId: string): ManagedSession | undefined {
    return this.sessions.get(taskRunId);
  }

  getSessionInfo(taskRunId: string):
    | {
        sessionId: string;
        repoPath: string;
        taskId: string;
        apiHost: string;
        projectId: number;
        adapter: "claude" | "codex" | undefined;
      }
    | undefined {
    const session = this.sessions.get(taskRunId);
    if (!session?.config.sessionId) return undefined;
    return {
      sessionId: session.config.sessionId,
      repoPath: session.repoPath,
      taskId: session.config.taskId,
      apiHost: session.config.credentials.apiHost,
      projectId: session.config.credentials.projectId,
      adapter: session.config.adapter,
    };
  }

  /**
   * Re-emit stored checkpoint notifications through the SessionEvent channel.
   * Called by the renderer after its subscription is set up so no events are lost.
   */
  replayCheckpoints(taskRunId: string): number {
    const checkpoints = this.sessionCheckpoints.get(taskRunId) ?? [];
    if (checkpoints.length === 0) return 0;

    this.log.info("Replaying stored checkpoints via SessionEvent", {
      taskRunId,
      count: checkpoints.length,
    });

    for (const { checkpointId, ts, promptId, turnCompletedAt } of checkpoints) {
      this.emit(AgentServiceEvent.SessionEvent, {
        taskRunId,
        payload: {
          type: "acp_message",
          ts,
          message: {
            jsonrpc: "2.0" as const,
            method: POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT,
            // Mark as replay so renderer doesn't re-sync to S3
            params: { checkpointId, promptId, turnCompletedAt, replay: true },
          },
        },
      });
    }

    return checkpoints.length;
  }

  /**
   * Get the promptId for a checkpoint. Used when truncating S3 log so the
   * backend can find the correct turn boundary by promptId.
   */
  /**
   * Returns all stored checkpoint entries for a session in capture order.
   * Used during local→cloud handoff to seed the cloud run log with prior
   * local checkpoints so they survive the next cloud→local handoff.
   */
  getCheckpointEntries(
    taskRunId: string,
  ): Array<{ checkpointId: string; promptId: number | undefined }> {
    return (this.sessionCheckpoints.get(taskRunId) ?? []).map(
      ({ checkpointId, promptId }) => ({ checkpointId, promptId }),
    );
  }

  getCheckpointPromptId(
    taskRunId: string,
    checkpointId: string,
  ): number | undefined {
    const checkpoints = this.sessionCheckpoints.get(taskRunId) ?? [];
    const cp = checkpoints.find((c) => c.checkpointId === checkpointId);
    return cp?.promptId;
  }

  /**
   * The turn-completion timestamp for a checkpoint (see the sessionCheckpoints
   * map). Used when re-appending the restored checkpoint's marker after a restore
   * so it carries the true turn boundary (the S3 truncate drops the original
   * marker), which the re-seeded-cache trim uses. Undefined for pre-fix or
   * cloud-registered checkpoints.
   */
  getCheckpointTurnCompletedAt(
    taskRunId: string,
    checkpointId: string,
  ): string | undefined {
    const checkpoints = this.sessionCheckpoints.get(taskRunId) ?? [];
    const cp = checkpoints.find((c) => c.checkpointId === checkpointId);
    return cp?.turnCompletedAt;
  }

  /**
   * Read-only: the checkpoint IDs that SURVIVE a restore to keepUpToCheckpointId
   * (everything up to and including the target). Used as a deletion whitelist so
   * orphan-ref cleanup never removes a surviving checkpoint's git ref. Returns []
   * when the target isn't in the in-memory map (e.g. after an app restart) — the
   * caller unions this with the truncated-log markers, which survive restart.
   */
  getSurvivingCheckpointIds(
    taskRunId: string,
    keepUpToCheckpointId: string,
  ): string[] {
    const cps = this.sessionCheckpoints.get(taskRunId) ?? [];
    const idx = cps.findIndex((c) => c.checkpointId === keepUpToCheckpointId);
    return idx === -1 ? [] : cps.slice(0, idx + 1).map((c) => c.checkpointId);
  }

  /**
   * Read-only: the FULL surviving checkpoint entries (id + promptId +
   * turnCompletedAt) up to and including keepUpToCheckpointId, in capture order.
   * Used by the restore to re-append survivor markers that a position-based S3
   * truncate dropped — an EARLIER turn's async-late capture can land in the log
   * after the restore target's marker, so truncating at the target's position cuts
   * that survivor too, leaving it with a "no checkpoint captured" icon. The map is
   * the authoritative source for the true `turnCompletedAt` (the S3 marker may be
   * gone). Returns [] when the target isn't in the map (e.g. after a restart).
   */
  getSurvivingCheckpointEntries(
    taskRunId: string,
    keepUpToCheckpointId: string,
  ): Array<{
    checkpointId: string;
    promptId: number | undefined;
    turnCompletedAt?: string;
  }> {
    const cps = this.sessionCheckpoints.get(taskRunId) ?? [];
    const idx = cps.findIndex((c) => c.checkpointId === keepUpToCheckpointId);
    return idx === -1
      ? []
      : cps.slice(0, idx + 1).map((c) => ({
          checkpointId: c.checkpointId,
          promptId: c.promptId,
          turnCompletedAt: c.turnCompletedAt,
        }));
  }

  /**
   * Remove stored checkpoints that come AFTER the given checkpointId (inclusive
   * of the target). Called after a restore so replayCheckpoints only re-emits
   * the surviving checkpoints and not orphaned ones whose git refs were deleted.
   */
  truncateCheckpoints(taskRunId: string, keepUpToCheckpointId: string): number {
    const checkpoints = this.sessionCheckpoints.get(taskRunId) ?? [];
    const idx = checkpoints.findIndex(
      (cp) => cp.checkpointId === keepUpToCheckpointId,
    );
    if (idx === -1) return 0;
    this.sessionCheckpoints.set(taskRunId, checkpoints.slice(0, idx + 1));
    this.log.info("Truncated stored checkpoints after restore", {
      taskRunId,
      keepUpTo: keepUpToCheckpointId,
      kept: idx + 1,
      removed: checkpoints.length - idx - 1,
    });
    return idx + 1;
  }

  /**
   * Register a cloud-originated checkpoint into the local sessionCheckpoints map
   * so it participates in replayCheckpoints, getCheckpointPromptId, and
   * truncateCheckpoints exactly like a locally captured checkpoint.
   *
   * Called by HandoffService after cloud→local handoff so all cloud turn
   * checkpoints show enabled restore buttons on the local session.
   */
  registerCloudCheckpoint(
    taskRunId: string,
    entry: {
      checkpointId: string;
      promptId: number | undefined;
      ts: number;
      // True turn boundary from the cloud capture (marker params). When present the
      // desktop binds the restore icon by it instead of the async-late `ts` /
      // turn-index `promptId`; replayCheckpoints re-emits it to the renderer.
      turnCompletedAt?: string;
    },
  ): void {
    const existing = this.sessionCheckpoints.get(taskRunId) ?? [];
    // Deduplicate: don't add the same checkpoint twice (e.g. if handoff is
    // retried or the sync runs twice).
    if (existing.some((c) => c.checkpointId === entry.checkpointId)) {
      this.log.debug("Skipping duplicate cloud checkpoint registration", {
        taskRunId,
        checkpointId: entry.checkpointId,
      });
      return;
    }
    existing.push(entry);
    this.sessionCheckpoints.set(taskRunId, existing);

    this.log.info("Registered cloud checkpoint for local session", {
      taskRunId,
      checkpointId: entry.checkpointId,
      promptId: entry.promptId,
      turnCompletedAt: entry.turnCompletedAt,
      totalStored: existing.length,
    });

    // Emit to renderer so the restore button activates immediately without
    // needing a replayCheckpoints call.
    this.emit(AgentServiceEvent.SessionEvent, {
      taskRunId,
      payload: {
        type: "acp_message",
        ts: entry.ts,
        message: {
          jsonrpc: "2.0" as const,
          method: POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT,
          params: {
            checkpointId: entry.checkpointId,
            promptId: entry.promptId,
            // Bind the icon to the right turn immediately (not just after a later
            // replayCheckpoints), same key the replay path emits.
            turnCompletedAt: entry.turnCompletedAt,
          },
        },
      },
    });
  }

  /**
   * Mark a taskRunId so the next reconnect forces JSONL re-hydration from S3
   * instead of reusing an existing (stale) JSONL file. Called before cancelSession
   * during checkpoint restore so hydrateSessionJsonl skips the "already exists" guard.
   */
  markCheckpointRestore(taskRunId: string): void {
    this.checkpointRestoreTaskRunIds.add(taskRunId);
    this.log.info("Marked taskRunId for force JSONL refetch on reconnect", {
      taskRunId,
    });
  }

  getDebugSnapshot(): {
    sessions: Array<{
      taskRunId: string;
      taskId: string;
      repoPath: string;
      adapter: string;
      model: string | null;
      sessionId: string | null;
      channel: string;
      createdAt: number;
      lastActivityAt: number;
      promptPending: boolean;
      inFlightToolCalls: number;
      idleDeadline: number | null;
    }>;
    pendingPermissions: Array<{
      taskRunId: string;
      toolCallId: string;
    }>;
  } {
    const sessions = [...this.sessions.values()].map((session) => ({
      taskRunId: session.taskRunId,
      taskId: session.taskId,
      repoPath: session.repoPath,
      adapter: session.config.adapter ?? "claude",
      model: session.config.model ?? null,
      sessionId: session.config.sessionId ?? null,
      channel: session.channel,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      promptPending: session.promptPending,
      inFlightToolCalls: session.inFlightMcpToolCalls.size,
      idleDeadline: this.idleTimeouts.get(session.taskRunId)?.deadline ?? null,
    }));
    const pendingPermissions = [...this.pendingPermissions.values()].map(
      (perm) => ({
        taskRunId: perm.taskRunId,
        toolCallId: perm.toolCallId,
      }),
    );
    return { sessions, pendingPermissions };
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
      this.log.error("Failed to set session config option", {
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
   * Resolve env-var overrides set by the SessionStart-style hooks of the most
   * recently active agent session for `taskId`.
   *
   * Used by git/gh operations triggered from the UI (Commit, Create PR) so
   * they pick up the same hook env the agent itself sees — most importantly
   * the SSH_AUTH_SOCK that Secretive's hook re-points at the Secretive agent
   * for commit signing. Returns an empty object when there is no session for
   * the task or when no hook output is available.
   */
  public async getSessionEnvForTask(
    taskId: string,
  ): Promise<Record<string, string>> {
    const candidates = this.listSessions(taskId)
      .filter((s) => !!s.config.sessionId)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    const session = candidates[0];
    if (!session?.config.sessionId) return {};
    return loadSessionEnvOverrides(session.config.sessionId);
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
    this.log.info("Resuming interrupted session", {
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
      this.log.warn("Session not found for setPendingContext", { taskRunId });
      return;
    }
    session.pendingContext = context;
    this.log.info("Set pending context on session", {
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
      this.log.warn("Session not found for context notification", {
        sessionId,
      });
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

    this.log.info("Notified session of context change", {
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
    this.log.info("Cleaning up all agent sessions", {
      sessionCount: sessionIds.length,
    });

    for (const session of this.sessions.values()) {
      try {
        await session.agent.flushAllLogs();
      } catch {
        this.log.debug("Failed to flush session logs during shutdown");
      }
    }

    for (const taskRunId of sessionIds) {
      await this.cleanupSession(taskRunId);
    }

    this.log.info("All agent sessions cleaned up");
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
        this.log.warn("Failed to setup mock node environment", err);
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
      if (session.promptPending || session.inFlightMcpToolCalls.size > 0) {
        this.log.warn("Cleaning up session with in-flight work", {
          taskRunId,
          taskId: session.taskId,
          promptPending: session.promptPending,
          inFlightMcpToolCalls: session.inFlightMcpToolCalls.size,
        });
      }
      this.cancelInFlightMcpToolCalls(session);
      this.sleepService.release(taskRunId);
      try {
        await session.agent.cleanup();
      } catch {
        this.log.debug("Agent cleanup failed", { taskRunId });
      }

      await cleanupCodexHome(this.storagePaths.appDataPath, taskRunId).catch(
        () => this.log.debug("Codex home cleanup failed", { taskRunId }),
      );

      this.sessions.delete(taskRunId);

      const timeout = this.idleTimeouts.get(taskRunId);
      if (timeout) {
        clearTimeout(timeout.handle);
        this.idleTimeouts.delete(taskRunId);
      }

      // When no sessions remain, tear down MCP Apps connections and cached resources
      if (this.sessions.size === 0) {
        this.mcpAppsService.cleanup().catch(() => {
          this.log.debug("MCP Apps cleanup failed");
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

    // Track the most recent session/prompt request ID so the checkpoint
    // notification can be tagged with the turn it belongs to.
    let latestPromptId: number | undefined;

    const onAcpMessage = (message: unknown) => {
      const acpMessage: AcpMessage = {
        type: "acp_message",
        ts: Date.now(),
        message: message as AcpMessage["message"],
      };
      emitToRenderer(acpMessage);

      // Track session/prompt request IDs for turn-tagging
      const raw = message as { method?: string; id?: number };
      if (raw.method === "session/prompt" && raw.id !== undefined) {
        latestPromptId = raw.id;
        this.log.debug("Tracked session/prompt id", {
          taskRunId,
          promptId: raw.id,
        });
      }

      // Inspect tool call updates for PR URLs and file activity
      this.handleToolCallUpdate(taskRunId, message as AcpMessage["message"]);

      // Capture a local git checkpoint when a turn completes.
      // Intercepted here (raw stream tap) rather than extNotification because
      // the ACP SDK does not reliably route _posthog/ notifications to that callback.
      this.handleTurnCompleteForCheckpoint(
        taskRunId,
        message,
        latestPromptId,
        emitToRenderer,
      );
    };

    const tappedReadable = createTappedReadableStream(
      clientStreams.readable as ReadableStream<Uint8Array>,
      onAcpMessage,
      service.log,
    );

    const tappedWritable = createTappedWritableStream(
      clientStreams.writable as WritableStream<Uint8Array>,
      onAcpMessage,
      service.log,
    );

    const client: Client = {
      async requestPermission(
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> {
        const toolName =
          (params.toolCall?.rawInput as { toolName?: string } | undefined)
            ?.toolName || "";
        const toolCallId = params.toolCall?.toolCallId || "";

        service.log.info("requestPermission called", {
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
            service.log.info("Auto-approving read-only MCP tool", {
              taskRunId,
              toolName,
            });
            return { outcome: buildAutoApproveOutcome(params.options) };
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

                service.log.info("Emitting permission request to renderer", {
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
                  service.log.warn(
                    "Failed to update tool approval on backend",
                    {
                      toolName,
                      error: err instanceof Error ? err.message : String(err),
                    },
                  );
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
        service.log.warn(
          "No toolCallId in permission request, auto-approving",
          {
            taskRunId,
            toolName,
          },
        );
        return { outcome: buildAutoApproveOutcome(params.options) };
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
            service.log.info("Session ID captured", {
              taskRunId: notifTaskRunId,
              sessionId,
              adapter: notifAdapter,
            });
          }
        }

        if (isNotification(method, POSTHOG_NOTIFICATIONS.USAGE_UPDATE)) {
          this.emit(AgentServiceEvent.LlmActivity, undefined);
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
      permissionMode:
        "permissionMode" in params ? params.permissionMode : undefined,
      customInstructions:
        "customInstructions" in params ? params.customInstructions : undefined,
      systemPromptOverride:
        "systemPromptOverride" in params
          ? params.systemPromptOverride
          : undefined,
      disallowedTools:
        "disallowedTools" in params ? params.disallowedTools : undefined,
      effort: "effort" in params ? params.effort : undefined,
      model: "model" in params ? params.model : undefined,
      jsonSchema: "jsonSchema" in params ? params.jsonSchema : undefined,
      importedSessionId:
        "importedSessionId" in params ? params.importedSessionId : undefined,
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
      const session = this.sessions.get(taskRunId);

      // Runs before the toolName gate: a PR URL can surface without a Bash
      // toolName (e.g. in terminal output).
      this.maybeAttachCreatedPr(taskRunId, session, update);

      const toolMeta = update._meta?.claudeCode;
      const toolName = toolMeta?.toolName;
      if (!toolName) return;

      this.trackAgentFileActivity(taskRunId, session, toolName);
    } catch (err) {
      this.log.debug("Error in tool call update handling", {
        taskRunId,
        error: err,
      });
    }
  }

  private maybeAttachCreatedPr(
    taskRunId: string,
    session: ManagedSession | undefined,
    update: unknown,
  ): void {
    if (!session || session.prAttributed) return;
    const prUrl = findPrUrl(JSON.stringify(update));
    if (!prUrl || session.evaluatedPrUrls.has(prUrl)) return;
    session.evaluatedPrUrls.add(prUrl);
    void this.attachPrIfCreatedThisRun(taskRunId, session, prUrl);
  }

  private async attachPrIfCreatedThisRun(
    taskRunId: string,
    session: ManagedSession,
    prUrl: string,
  ): Promise<void> {
    if (session.prAttributed) return;

    const createdAt = await this.fetchPrCreatedAt(session.repoPath, prUrl);
    if (!wasCreatedRecently(createdAt, Date.now())) return;
    // Re-check after the await: another URL may have attributed while we waited.
    if (session.prAttributed) return;

    session.prAttributed = true;
    this.log.info("Detected PR URL created during run", { taskRunId, prUrl });

    session.agent
      .attachPullRequestToTask(session.taskId, prUrl)
      .then(() => {
        this.log.info("PR URL attached to task", {
          taskRunId,
          taskId: session.taskId,
          prUrl,
        });
      })
      .catch((err) => {
        this.log.error("Failed to attach PR URL to task", {
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

  /** PR `createdAt` (ISO) via the GitHub CLI, or null if it can't be resolved. */
  private async fetchPrCreatedAt(
    cwd: string,
    prUrl: string,
  ): Promise<string | null> {
    try {
      const res = await execGh(["pr", "view", prUrl, "--json", "createdAt"], {
        cwd,
        timeoutMs: 10_000,
      });
      if (res.exitCode !== 0) return null;
      return (
        (JSON.parse(res.stdout) as { createdAt?: string }).createdAt ?? null
      );
    } catch (err) {
      this.log.debug("Failed to resolve PR createdAt", { prUrl, error: err });
      return null;
    }
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
        this.log.warn("Failed to emit agent file activity event", {
          taskRunId,
          taskId: session.taskId,
          ...context,
          error: err,
        });
      });
  }

  private handleTurnCompleteForCheckpoint(
    taskRunId: string,
    message: unknown,
    promptId: number | undefined,
    emitToRenderer: (payload: unknown) => void,
  ): void {
    const msg = message as { method?: string };
    if (!isNotification(msg.method, POSTHOG_NOTIFICATIONS.TURN_COMPLETE))
      return;

    const session = this.sessions.get(taskRunId);
    if (!session?.config.repoPath) {
      this.log.debug(
        "TURN_COMPLETE in stream — no repoPath, skipping checkpoint",
        {
          taskRunId,
        },
      );
      return;
    }

    this.log.info("TURN_COMPLETE in stream — capturing local checkpoint", {
      taskRunId,
      repoPath: session.config.repoPath,
      promptId,
    });

    // Stamp the turn boundary NOW, before the async snapshot. The snapshot can
    // take minutes on a large repo, so if we used the capture-completion time the
    // marker would sort after later turns' prompts and the restore-truncation
    // boundary would keep them (stale turns after restore).
    const turnCompletedAt = new Date().toISOString();

    this.captureLocalCheckpoint(
      taskRunId,
      session.config.repoPath,
      session.config.sessionId,
      promptId,
      turnCompletedAt,
      emitToRenderer,
    ).catch((err) => {
      this.log.warn("Local checkpoint capture failed", {
        taskRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * Capture a local git checkpoint after a turn completes, emit the
   * `_posthog/git_checkpoint` notification to the renderer, and append it to
   * the session JSONL so it survives page reload.
   */
  private async captureLocalCheckpoint(
    taskRunId: string,
    repoPath: string,
    sessionId: string | undefined,
    promptId: number | undefined,
    turnCompletedAt: string,
    emitToRenderer: (payload: unknown) => void,
  ): Promise<void> {
    this.log.info("Capturing local checkpoint after turn", {
      taskRunId,
      repoPath,
    });

    const captureStart = Date.now();
    const saga = new CaptureCheckpointSaga();
    const sagaResult = await saga.run({ baseDir: repoPath });
    const captureMs = Date.now() - captureStart;
    if (!sagaResult.success) {
      this.log.warn(
        "CaptureCheckpointSaga failed — no checkpoint for this turn",
        {
          taskRunId,
          error: sagaResult.error,
          captureMs,
        },
      );
      return;
    }

    const result = sagaResult.data;
    // The saga's git ops are ~seconds; a much larger captureMs usually means it
    // queued behind another git write on this repo (the per-repo write lock).
    // Flagged so a slow capture (which can delay a concurrent restore) is obvious.
    if (captureMs > 10_000) {
      this.log.warn("Local checkpoint capture was slow", {
        taskRunId,
        captureMs,
      });
    }
    this.log.info("Local checkpoint captured", {
      taskRunId,
      checkpointId: result.checkpointId,
      commit: result.commit,
      branch: result.branch,
      captureMs,
    });

    // Persist mapping so we can re-inject on reconnect, with promptId for
    // correct turn association regardless of when the notification arrives.
    const ts = Date.now();
    const existing = this.sessionCheckpoints.get(taskRunId) ?? [];
    existing.push({
      checkpointId: result.checkpointId,
      ts,
      promptId,
      turnCompletedAt,
    });
    this.sessionCheckpoints.set(taskRunId, existing);
    this.log.info("Stored checkpoint for reconnect replay", {
      taskRunId,
      checkpointId: result.checkpointId,
      promptId,
      totalStored: existing.length,
    });

    const notification = {
      jsonrpc: "2.0" as const,
      method: POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT,
      // turnCompletedAt rides in params so it survives the S3 round-trip (the
      // restore truncation reads it back from the re-seeded log).
      params: { checkpointId: result.checkpointId, promptId, turnCompletedAt },
    };

    // Emit to renderer so the restore button activates on the completed turn
    const acpMessage: AcpMessage = {
      type: "acp_message",
      ts: Date.now(),
      message: notification as AcpMessage["message"],
    };
    emitToRenderer(acpMessage);

    this.log.info("Emitted GIT_CHECKPOINT notification to renderer", {
      taskRunId,
      checkpointId: result.checkpointId,
    });

    // Append to the session JSONL so restore can find the checkpoint on reload
    if (sessionId) {
      try {
        const jsonlPath = getSessionJsonlPath(sessionId, repoPath);
        const line = `${JSON.stringify({ notification })}\n`;
        await fsPromises.appendFile(jsonlPath, line, "utf-8");
        this.log.info("Checkpoint appended to JSONL", {
          taskRunId,
          checkpointId: result.checkpointId,
          jsonlPath,
        });
      } catch (err) {
        this.log.warn(
          "Failed to append checkpoint to JSONL (restore may not survive reload)",
          {
            taskRunId,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    } else {
      this.log.warn("No sessionId yet — checkpoint not written to JSONL", {
        taskRunId,
      });
    }

    // Also append to the local logs.ndjson cache. The renderer's fetchSessionLogs
    // reads logs.ndjson first (before S3), and the in-memory sessionCheckpoints
    // map is lost when the main process restarts. Without this, the checkpoint
    // notification lives only in S3 + the in-memory map, so after the app is
    // reopened the cold load reads a checkpoint-less local cache and every
    // restore icon goes disabled. This append (matching the SessionLogWriter
    // tap's line-by-line model) keeps checkpoints visible across restarts.
    try {
      const sessionDir = join(homedir(), DATA_DIR, "sessions", taskRunId);
      await fsPromises.mkdir(sessionDir, { recursive: true });
      const entry = {
        type: "notification" as const,
        // Turn-completion time, not append time — see captureLocalCheckpoint's
        // turnCompletedAt. Keeps this cache entry's timestamp on the true turn
        // boundary so a cold-load trim cuts correctly.
        timestamp: turnCompletedAt,
        notification,
      };
      await fsPromises.appendFile(
        join(sessionDir, "logs.ndjson"),
        `${JSON.stringify(entry)}\n`,
        "utf-8",
      );
      this.log.info("Checkpoint appended to local logs.ndjson", {
        taskRunId,
        checkpointId: result.checkpointId,
      });
    } catch (err) {
      this.log.warn("Failed to append checkpoint to local logs.ndjson", {
        taskRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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

    return mapped.sort((a, b) => {
      const providerOrder = ["Anthropic", "OpenAI", "Gemini"];
      const aProviderIdx = providerOrder.indexOf(a.provider ?? "");
      const bProviderIdx = providerOrder.indexOf(b.provider ?? "");
      if (aProviderIdx !== bProviderIdx) {
        const aIdx = aProviderIdx === -1 ? 999 : aProviderIdx;
        const bIdx = bProviderIdx === -1 ? 999 : bProviderIdx;
        return aIdx - bIdx;
      }
      return (
        getClaudeModelRecency(a.modelId) - getClaudeModelRecency(b.modelId)
      );
    });
  }

  async getPreviewConfigOptions(
    apiHost: string,
    adapter: "claude" | "codex" = "claude",
  ): Promise<SessionConfigOption[]> {
    const gatewayUrl = getLlmGatewayUrl(apiHost);
    const gatewayModels = await fetchGatewayModels({ gatewayUrl });

    // The Claude adapter can also drive Cloudflare `@cf/` models the gateway serves over its
    // Anthropic-Messages surface, so the preview/default-model path must offer them too — otherwise an
    // advertised `@cf/*` model is dropped here and the pre-session run falls back to Opus.
    const modelFilter =
      adapter === "codex"
        ? isOpenAIModel
        : (model: GatewayModel) =>
            isAnthropicModel(model) || isCloudflareModel(model);

    const modelOptions = gatewayModels
      .filter((model) => modelFilter(model))
      .map((model) => ({
        value: model.id,
        name: formatGatewayModelName(model),
        description: `Context: ${model.context_window.toLocaleString()} tokens`,
      }));

    // The gateway returns models in an arbitrary order. Sort Claude models
    // oldest-to-newest so the picker is deterministic and the newest model
    // lands at the end of the list, closest to the trigger.
    if (adapter === "claude") {
      modelOptions.sort(
        (a, b) =>
          getClaudeModelRecency(a.value) - getClaudeModelRecency(b.value),
      );
    }

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
