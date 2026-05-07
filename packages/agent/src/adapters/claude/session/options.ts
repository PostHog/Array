import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  CanUseTool,
  McpServerConfig,
  Options,
  OutputFormat,
  SpawnedProcess,
  SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import type { FileEnrichmentDeps } from "../../../enrichment/file-enricher";
import { IS_ROOT } from "../../../utils/common";
import type { Logger } from "../../../utils/logger";
import {
  createPostToolUseHook,
  createPreToolUseHook,
  createReadEnrichmentHook,
  createSubagentRewriteHook,
  type EnrichedReadCache,
  type OnModeChange,
} from "../hooks";
import type { CodeExecutionMode } from "../tools";
import type { EffortLevel } from "../types";
import { APPENDED_INSTRUCTIONS } from "./instructions";
import { loadUserClaudeJsonMcpServers } from "./mcp-config";
import { DEFAULT_MODEL } from "./models";
import type { SettingsManager } from "./settings";

export interface ProcessSpawnedInfo {
  pid: number;
  command: string;
  sessionId: string;
}

export interface BuildOptionsParams {
  cwd: string;
  mcpServers: Record<string, McpServerConfig>;
  permissionMode: CodeExecutionMode;
  canUseTool: CanUseTool;
  logger: Logger;
  systemPrompt?: Options["systemPrompt"];
  userProvidedOptions?: Options;
  sessionId: string;
  isResume: boolean;
  forkSession?: boolean;
  additionalDirectories?: string[];
  disableBuiltInTools?: boolean;
  outputFormat?: OutputFormat;
  settingsManager: SettingsManager;
  onModeChange?: OnModeChange;
  onProcessSpawned?: (info: ProcessSpawnedInfo) => void;
  onProcessExited?: (pid: number) => void;
  effort?: EffortLevel;
  enrichmentDeps?: FileEnrichmentDeps;
  enrichedReadCache?: EnrichedReadCache;
}

export function buildSystemPrompt(
  customPrompt?: unknown,
): Options["systemPrompt"] {
  const defaultPrompt: Options["systemPrompt"] = {
    type: "preset",
    preset: "claude_code",
    append: APPENDED_INSTRUCTIONS,
  };

  if (!customPrompt) {
    return defaultPrompt;
  }

  if (typeof customPrompt === "string") {
    return customPrompt + APPENDED_INSTRUCTIONS;
  }

  if (
    typeof customPrompt === "object" &&
    customPrompt !== null &&
    "append" in customPrompt &&
    typeof customPrompt.append === "string"
  ) {
    return {
      ...defaultPrompt,
      append: customPrompt.append + APPENDED_INSTRUCTIONS,
    };
  }

  return defaultPrompt;
}

function buildMcpServers(
  userServers: Record<string, McpServerConfig> | undefined,
  acpServers: Record<string, McpServerConfig>,
  projectScopedServers: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> {
  return {
    ...projectScopedServers,
    ...(userServers || {}),
    ...acpServers,
  };
}

function buildEnvironment(): Record<string, string> {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL: "true",
    // Offload all MCP tools by default
    ENABLE_TOOL_SEARCH: "auto:0",
    // Enable idle state as end-of-turn signal (required for SDK 0.2.114+)
    CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
  };
}

function buildHooks(
  userHooks: Options["hooks"],
  onModeChange: OnModeChange | undefined,
  settingsManager: SettingsManager,
  logger: Logger,
  enrichmentDeps: FileEnrichmentDeps | undefined,
  enrichedReadCache: EnrichedReadCache | undefined,
  registeredAgents: ReadonlySet<string>,
): Options["hooks"] {
  const postToolUseHooks = [createPostToolUseHook({ onModeChange })];
  if (enrichmentDeps && enrichedReadCache) {
    postToolUseHooks.push(
      createReadEnrichmentHook(enrichmentDeps, enrichedReadCache),
    );
  }

  return {
    ...userHooks,
    PostToolUse: [
      ...(userHooks?.PostToolUse || []),
      { hooks: postToolUseHooks },
    ],
    PreToolUse: [
      ...(userHooks?.PreToolUse || []),
      {
        hooks: [
          createPreToolUseHook(settingsManager, logger),
          createSubagentRewriteHook(logger, registeredAgents),
        ],
      },
    ],
  };
}

/**
 * Read-only Haiku-powered exploration agent. Registered under the `ph-explore`
 * name rather than `Explore` to work around a Claude Agent SDK bug where
 * `options.agents` cannot shadow built-in agent definitions. The
 * `createSubagentRewriteHook` rewrites `subagent_type: "Explore"` to
 * `"ph-explore"` so callers don't have to know about the alias.
 */
const PH_EXPLORE_AGENT: NonNullable<Options["agents"]>[string] = {
  description:
    'Fast agent for exploring and understanding codebases. Use this when you need to find files by pattern (eg. "src/components/**/*.tsx"), search for code or keywords (eg. "where is the auth middleware?"), or answer questions about how the codebase works (eg. "how does the session service handle reconnects?"). When calling this agent, specify a thoroughness level: "quick" for targeted lookups, "medium" for broader exploration, or "very thorough" for comprehensive analysis across multiple locations.',
  model: "sonnet",
  prompt: `You are a fast, read-only codebase exploration agent.

Your job is to find files, search code, read the most relevant sources, and report findings clearly.

Rules:
- Never create, modify, delete, move, or copy files.
- Never use shell redirection or any command that changes system state.
- Use Glob for broad file pattern matching.
- Use Grep for searching file contents.
- Use Read when you know the exact file path to inspect.
- Use Bash only for safe read-only commands like ls, git status, git log, git diff, find, cat, head, and tail.
- Adapt your search approach based on the thoroughness level specified by the caller.
- Return file paths as absolute paths in your final response.
- Avoid using emojis.
- Wherever possible, spawn multiple parallel tool calls for grepping and reading files.
- Search efficiently, then read only the most relevant files.
- Return findings directly in your final response — do not create files.`,
  tools: [
    "Bash",
    "Glob",
    "Grep",
    "Read",
    "WebFetch",
    "WebSearch",
    "NotebookRead",
    "TodoWrite",
  ],
};

function buildAgents(
  userAgents: Options["agents"],
): NonNullable<Options["agents"]> {
  return {
    "ph-explore": PH_EXPLORE_AGENT,
    ...(userAgents || {}),
  };
}

function getAbortController(
  userProvidedController: AbortController | undefined,
): AbortController {
  const controller = userProvidedController ?? new AbortController();
  if (controller.signal.aborted) {
    throw new Error("Cancelled");
  }
  return controller;
}

function buildSpawnWrapper(
  sessionId: string,
  onProcessSpawned: (info: ProcessSpawnedInfo) => void,
  onProcessExited?: (pid: number) => void,
  logger?: Logger,
): (options: SpawnOptions) => SpawnedProcess {
  return (spawnOpts: SpawnOptions): SpawnedProcess => {
    const child = spawn(spawnOpts.command, spawnOpts.args, {
      cwd: spawnOpts.cwd,
      env: spawnOpts.env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (child.pid) {
      onProcessSpawned({
        pid: child.pid,
        command: `${spawnOpts.command} ${spawnOpts.args.join(" ")}`,
        sessionId,
      });
    }

    child.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && logger) {
        logger.debug(`[claude-code:${child.pid}] stderr: ${msg}`);
      }
    });

    if (onProcessExited) {
      child.on("exit", () => {
        if (child.pid) {
          onProcessExited(child.pid);
        }
      });
    }

    // Listen for abort signal
    if (spawnOpts.signal) {
      spawnOpts.signal.addEventListener("abort", () => {
        child.kill("SIGTERM");
      });
    }

    if (!child.stdin || !child.stdout) {
      throw new Error(
        `Failed to get stdio streams for spawned process (pid=${child.pid})`,
      );
    }

    return {
      stdin: child.stdin,
      stdout: child.stdout,
      get killed() {
        return child.killed;
      },
      get exitCode() {
        return child.exitCode;
      },
      kill(signal: NodeJS.Signals) {
        return child.kill(signal);
      },
      // biome-ignore lint/suspicious/noExplicitAny: ChildProcess event listener types require any[]
      on(event: "exit" | "error", listener: (...args: any[]) => void) {
        child.on(event, listener);
      },
      // biome-ignore lint/suspicious/noExplicitAny: ChildProcess event listener types require any[]
      once(event: "exit" | "error", listener: (...args: any[]) => void) {
        child.once(event, listener);
      },
      // biome-ignore lint/suspicious/noExplicitAny: ChildProcess event listener types require any[]
      off(event: "exit" | "error", listener: (...args: any[]) => void) {
        child.off(event, listener);
      },
    };
  };
}

function ensureLocalSettings(cwd: string): void {
  const claudeDir = path.join(cwd, ".claude");
  const localSettingsPath = path.join(claudeDir, "settings.local.json");
  try {
    if (!fs.existsSync(localSettingsPath)) {
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(localSettingsPath, "{}\n", { flag: "wx" });
    }
  } catch {
    // Best-effort — don't fail session creation if we can't write
  }
}

export function buildSessionOptions(params: BuildOptionsParams): Options {
  ensureLocalSettings(params.cwd);

  // Resolve which built-in tools to expose.
  // Explicit tools array from userProvidedOptions takes precedence.
  // disableBuiltInTools is a legacy shorthand for tools: [] — kept for
  // backward compatibility but callers should prefer the tools array.
  const tools: Options["tools"] =
    params.userProvidedOptions?.tools ??
    (params.disableBuiltInTools
      ? []
      : { type: "preset", preset: "claude_code" });

  const agents = buildAgents(params.userProvidedOptions?.agents);
  const registeredAgentNames = new Set(Object.keys(agents));

  const options: Options = {
    ...params.userProvidedOptions,
    betas: ["context-1m-2025-08-07"],
    systemPrompt: params.systemPrompt ?? buildSystemPrompt(),
    settingSources: ["user", "project", "local"],
    stderr: (err) => params.logger.error(err),
    cwd: params.cwd,
    includePartialMessages: true,
    allowDangerouslySkipPermissions: !IS_ROOT || !!process.env.IS_SANDBOX,
    permissionMode: params.permissionMode,
    canUseTool: params.canUseTool,
    executable: "node",
    tools,
    agents,
    extraArgs: {
      ...params.userProvidedOptions?.extraArgs,
      "replay-user-messages": "",
    },
    mcpServers: buildMcpServers(
      params.userProvidedOptions?.mcpServers,
      params.mcpServers,
      loadUserClaudeJsonMcpServers(params.cwd, params.logger),
    ),
    env: buildEnvironment(),
    hooks: buildHooks(
      params.userProvidedOptions?.hooks,
      params.onModeChange,
      params.settingsManager,
      params.logger,
      params.enrichmentDeps,
      params.enrichedReadCache,
      registeredAgentNames,
    ),
    outputFormat: params.outputFormat,
    abortController: getAbortController(
      params.userProvidedOptions?.abortController,
    ),
    ...(params.onProcessSpawned && {
      spawnClaudeCodeProcess: buildSpawnWrapper(
        params.sessionId,
        params.onProcessSpawned,
        params.onProcessExited,
        params.logger,
      ),
    }),
  };

  if (process.env.CLAUDE_CODE_EXECUTABLE) {
    options.pathToClaudeCodeExecutable = process.env.CLAUDE_CODE_EXECUTABLE;
  }

  if (params.isResume) {
    options.resume = params.sessionId;
    options.forkSession = params.forkSession ?? false;
  } else {
    options.sessionId = params.sessionId;
    options.model = DEFAULT_MODEL;
  }

  if (params.additionalDirectories) {
    options.additionalDirectories = params.additionalDirectories;
  }

  if (params.effort) {
    options.effort = params.effort;
  }

  clearStatsigCache();
  return options;
}

function clearStatsigCache(): void {
  const statsigPath = path.join(
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
    "statsig",
  );
  fs.rm(statsigPath, { recursive: true, force: true }, () => {
    // Best-effort, ignore errors
  });
}
