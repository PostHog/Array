import type { HookCallback, HookInput } from "@anthropic-ai/claude-agent-sdk";
import {
  enrichFileForAgent,
  type FileEnrichmentDeps,
} from "../../enrichment/file-enricher";
import type { Logger } from "../../utils/logger";
import { SIGNED_COMMIT_QUALIFIED_TOOL_NAME } from "../signed-commit-shared";
import { stripCatLineNumbers } from "./conversion/sdk-to-acp";
import type { TaskState } from "./conversion/task-state";
import { gitSubcommand } from "./git-command";
import { neutralizeUnprocessableImages } from "./image-sanitization";
import {
  extractPostHogSubTool,
  isPostHogAlwaysGatedSubTool,
  isPostHogDestructiveSubTool,
  isPostHogExecTool,
} from "./permissions/posthog-exec-gate";
import type { SettingsManager } from "./session/settings";
import type { CodeExecutionMode } from "./tools";

function extractTextFromToolResponse(response: unknown): string | null {
  if (typeof response === "string") return response;
  if (!response) return null;
  if (Array.isArray(response)) {
    const parts: string[] = [];
    for (const part of response) {
      if (typeof part === "string") {
        parts.push(part);
      } else if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        parts.push((part as { text: string }).text);
      }
    }
    return parts.length > 0 ? parts.join("") : null;
  }
  if (typeof response === "object" && response !== null) {
    const maybe = response as {
      content?: unknown;
      text?: unknown;
      file?: { content?: unknown };
    };
    if (
      maybe.file &&
      typeof maybe.file === "object" &&
      typeof maybe.file.content === "string"
    ) {
      return maybe.file.content;
    }
    if (typeof maybe.text === "string") return maybe.text;
    if (maybe.content) return extractTextFromToolResponse(maybe.content);
  }
  return null;
}

// Parse the first JSON object embedded in a string (e.g. the `{...}` arg of a
// PostHog `call --json <tool> {...}` command, or a JSON tool result). Returns
// null when there's no parseable object.
function parseEmbeddedJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(text.slice(start));
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// The `id` (dashboard id) a workflow build's canvas publish targets, read from
// the `desktop-file-system-canvas-partial-update` command's JSON arg.
function parseCanvasPublishDashboardId(toolInput: unknown): string | null {
  const command = (toolInput as { command?: unknown })?.command;
  if (typeof command !== "string") return null;
  const arg = parseEmbeddedJsonObject(command);
  return arg && typeof arg.id === "string" ? arg.id : null;
}

// A top-level `key: value` line from a YAML-ish blob (no leading indentation,
// so nested blocks like `created_by:` don't shadow the workflow's own fields).
// The PostHog MCP renders results as YAML, not JSON.
function parseTopLevelYamlValue(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`^${key}:[ \\t]*(.+)$`, "m"));
  if (!match) return undefined;
  const value = match[1].trim().replace(/^"(.*)"$/, "$1");
  return value || undefined;
}

// The workflow id + status from a `workflows-create` / `workflows-get` result.
// The PostHog MCP returns the workflow as a YAML document (top-level `id:` /
// `name:` / `status:` lines); older/other shapes may be JSON, possibly wrapped.
// Best effort - returns null if no workflow id is present.
function parseWorkflowFromResponse(response: unknown): {
  workflowId: string;
  workflowStatus?: string;
  workflowName?: string;
} | null {
  const text = extractTextFromToolResponse(response);
  if (!text) return null;

  const root = parseEmbeddedJsonObject(text);
  if (root) {
    for (const candidate of [
      root,
      root.workflow,
      root.result,
      root.data,
    ] as Record<string, unknown>[]) {
      if (candidate && typeof candidate === "object") {
        const id = (candidate as { id?: unknown }).id;
        if (typeof id === "string" && id) {
          const status = (candidate as { status?: unknown }).status;
          const name = (candidate as { name?: unknown }).name;
          return {
            workflowId: id,
            workflowStatus: typeof status === "string" ? status : undefined,
            workflowName:
              typeof name === "string" && name.trim() ? name : undefined,
          };
        }
      }
    }
  }

  // YAML document (what the MCP actually emits): top-level key: value lines.
  const id = parseTopLevelYamlValue(text, "id");
  if (id && /^[0-9a-f][0-9a-f-]{10,}$/i.test(id)) {
    return {
      workflowId: id,
      workflowStatus: parseTopLevelYamlValue(text, "status"),
      workflowName: parseTopLevelYamlValue(text, "name"),
    };
  }
  return null;
}

/**
 * Per-toolUseId handoff from the PostToolUse hook to `toolUpdateFromToolResult`.
 * Can't emit a standalone `tool_call_update` because the SDK emits its own
 * when it processes the tool_result, and the renderer applies it via
 * `Object.assign` — our earlier update would be overwritten.
 */
export type EnrichedReadCache = Map<string, string>;

export const createReadImageGuardHook =
  (): HookCallback => async (input: HookInput) => {
    if (input.hook_event_name !== "PostToolUse" || input.tool_name !== "Read") {
      return { continue: true };
    }

    const result = neutralizeUnprocessableImages(input.tool_response);
    if (!result.changed) return { continue: true };

    const updatedToolOutput = Array.isArray(input.tool_response)
      ? { content: result.value }
      : result.value;

    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PostToolUse" as const,
        updatedToolOutput,
      },
    };
  };

export const createReadEnrichmentHook =
  (deps: FileEnrichmentDeps, cache: EnrichedReadCache): HookCallback =>
  async (input: HookInput) => {
    if (input.hook_event_name !== "PostToolUse") return { continue: true };
    if (input.tool_name !== "Read") return { continue: true };

    const toolInput = input.tool_input as { file_path?: string } | undefined;
    const filePath = toolInput?.file_path;
    if (!filePath) return { continue: true };

    const raw = extractTextFromToolResponse(input.tool_response);
    if (!raw) return { continue: true };

    const enriched = await enrichFileForAgent(
      deps,
      filePath,
      stripCatLineNumbers(raw),
    );
    if (!enriched) return { continue: true };

    if (input.tool_use_id) {
      cache.set(input.tool_use_id, enriched);
    }

    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PostToolUse" as const,
        additionalContext: [
          `## PostHog metadata for ${filePath}`,
          "",
          "The file below is annotated with live data from the user's PostHog project:",
          "flag type / rollout / staleness / linked experiment, and for events the verification status,",
          "30-day volume, and unique-user count. Treat these as authoritative product context —",
          "they describe what is actually running in production.",
          "",
          enriched,
        ].join("\n"),
      },
    };
  };

const toolUseCallbacks: {
  [toolUseId: string]: {
    onPostToolUseHook?: (
      toolUseID: string,
      toolInput: unknown,
      toolResponse: unknown,
    ) => Promise<void>;
  };
} = {};

export const registerHookCallback = (
  toolUseID: string,
  {
    onPostToolUseHook,
  }: {
    onPostToolUseHook?: (
      toolUseID: string,
      toolInput: unknown,
      toolResponse: unknown,
    ) => Promise<void>;
  },
) => {
  toolUseCallbacks[toolUseID] = {
    onPostToolUseHook,
  };
};

/**
 * Pre-populate the per-session task list from SDK TaskCreated/TaskCompleted
 * hook events. These fire before the matching tool_result chunk arrives, so
 * by the time TaskUpdate runs (which only carries taskId + status) the entry
 * already exists with a real subject — no placeholder with empty content.
 *
 * Plan-update emission happens in the tool_result handler, which mirrors the
 * old TodoWrite suppress-tool-call + emit-plan flow.
 */
export const createTaskHook =
  (taskState: TaskState, onChange?: () => Promise<void>): HookCallback =>
  async (input: HookInput): Promise<{ continue: boolean }> => {
    const taskId =
      "task_id" in input && typeof input.task_id === "string"
        ? input.task_id
        : undefined;
    if (!taskId) return { continue: true };

    let mutated = false;
    if (input.hook_event_name === "TaskCreated") {
      if (!input.task_subject) return { continue: true };
      // Guard against the SDK firing TaskCreated twice for the same id —
      // re-entry would clobber any TaskUpdate that landed in between.
      if (taskState.has(taskId)) return { continue: true };
      taskState.set(taskId, {
        subject: input.task_subject,
        status: "pending",
        description: input.task_description,
      });
      mutated = true;
    } else if (input.hook_event_name === "TaskCompleted") {
      const existing = taskState.get(taskId);
      if (!existing || existing.status === "completed") {
        return { continue: true };
      }
      taskState.set(taskId, { ...existing, status: "completed" });
      mutated = true;
    }
    if (mutated && onChange) await onChange();
    return { continue: true };
  };

export type OnModeChange = (mode: CodeExecutionMode) => Promise<void>;

// The link a workflow build forms: the workflow (from a workflows-create
// result) tracked by the canvas it publishes (dashboardId from the publish call).
export interface WorkflowBuiltSignal {
  dashboardId: string;
  workflowId: string;
  workflowStatus?: string;
  workflowName?: string;
}

interface CreatePostToolUseHookParams {
  onModeChange?: OnModeChange;
  /** Called after a PostHog MCP `call` exec executes, with the sub-tool name
   *  and the raw command (the command embeds the SQL for execute-sql). */
  onPostHogResourceUsed?: (subTool: string, commandText?: string) => void;
  /** Called once a workflow build has both created a workflow and published
   *  its canvas - the host then writes the link onto the dashboard row. */
  onWorkflowBuilt?: (signal: WorkflowBuiltSignal) => void;
}

export const createPostToolUseHook = ({
  onModeChange,
  onPostHogResourceUsed,
  onWorkflowBuilt,
}: CreatePostToolUseHookParams): HookCallback => {
  // Session-scoped accumulation: the workflow is created before the canvas is
  // published, so remember the last workflow this run created and fire the
  // link the moment the canvas publish (which carries the dashboardId) lands.
  let pendingWorkflow: {
    workflowId: string;
    workflowStatus?: string;
    workflowName?: string;
  } | null = null;
  return async (
    input: HookInput,
    toolUseID: string | undefined,
  ): Promise<{ continue: boolean }> => {
    if (input.hook_event_name === "PostToolUse") {
      const toolName = input.tool_name;

      if (onModeChange && toolName === "EnterPlanMode") {
        await onModeChange("plan");
      }

      // Record PostHog product usage from the MCP exec dispatcher. Only the
      // `call <sub-tool>` verb counts as "used a resource" — extractPostHogSubTool
      // matches that verb and ignores introspection (tools/info/schema/search).
      if (onPostHogResourceUsed && isPostHogExecTool(toolName)) {
        const subTool = extractPostHogSubTool(input.tool_input);
        if (subTool) {
          const command = (input.tool_input as { command?: unknown })?.command;
          onPostHogResourceUsed(
            subTool,
            typeof command === "string" ? command : undefined,
          );
        }
      }

      // Observe a workflow build (deterministic, no model cooperation): the
      // workflow this run last created OR fetched is the one the canvas tracks;
      // the subsequent `desktop-file-system-canvas-partial-update` carries the
      // dashboard it publishes to. Pair them into the link the host persists.
      // Capturing `workflows-get` (not just `workflows-create`) is what lets a
      // build attach a canvas to an EXISTING workflow, not only a new one.
      if (onWorkflowBuilt && isPostHogExecTool(toolName)) {
        const subTool = extractPostHogSubTool(input.tool_input);
        if (subTool === "workflows-create" || subTool === "workflows-get") {
          const workflow = parseWorkflowFromResponse(input.tool_response);
          if (workflow) pendingWorkflow = workflow;
        } else if (
          subTool === "desktop-file-system-canvas-partial-update" &&
          pendingWorkflow
        ) {
          const dashboardId = parseCanvasPublishDashboardId(input.tool_input);
          if (dashboardId) {
            onWorkflowBuilt({ dashboardId, ...pendingWorkflow });
          }
        }
      }

      if (toolUseID) {
        const onPostToolUseHook =
          toolUseCallbacks[toolUseID]?.onPostToolUseHook;
        if (onPostToolUseHook) {
          await onPostToolUseHook(
            toolUseID,
            input.tool_input,
            input.tool_response,
          );
        }
        delete toolUseCallbacks[toolUseID];
      }
    }
    return { continue: true };
  };
};

/**
 * Rewrites Agent tool calls targeting built-in subagent types to use our custom
 * definitions instead. This works around a Claude Agent SDK bug where
 * `options.agents` cannot override built-in agent definitions because the
 * built-ins appear first in the agents array and `Array.find()` returns the
 * first match.
 *
 * By giving our custom agent a different name (e.g. "ph-explore") and rewriting
 * the subagent_type in the tool input, we sidestep the collision entirely.
 *
 * https://github.com/anthropics/claude-agent-sdk-typescript/issues/267
 */
export const SUBAGENT_REWRITES: Record<string, string> = {
  Explore: "ph-explore",
};

export const createSubagentRewriteHook =
  (logger: Logger, registeredAgents: ReadonlySet<string>): HookCallback =>
  async (input: HookInput, _toolUseID: string | undefined) => {
    if (input.hook_event_name !== "PreToolUse") {
      return { continue: true };
    }

    if (input.tool_name !== "Agent") {
      return { continue: true };
    }

    const toolInput = input.tool_input as Record<string, unknown> | undefined;
    const subagentType = toolInput?.subagent_type;
    if (typeof subagentType !== "string" || !SUBAGENT_REWRITES[subagentType]) {
      return { continue: true };
    }

    const target = SUBAGENT_REWRITES[subagentType];
    if (!registeredAgents.has(target)) {
      logger.warn(
        `[SubagentRewriteHook] Skipping rewrite ${subagentType} → ${target}: target agent not registered for this session. Falling back to built-in ${subagentType}.`,
      );
      return { continue: true };
    }

    logger.info(
      `[SubagentRewriteHook] Rewriting subagent_type: ${subagentType} → ${target}`,
    );

    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        updatedInput: {
          ...toolInput,
          subagent_type: target,
        },
      },
    };
  };

/**
 * True when any top-level shell segment of `command` is a direct `git commit` /
 * `git push` invocation (allowing `git`-level global flags like `-C path` or
 * `--no-pager`). Does not match subcommands such as `git stash push` or
 * `git log --grep=commit`. Git reached via command substitution (`$(git push)`)
 * is not caught here — the sandbox `git` PATH shim is the authoritative backstop;
 * this hook is a fast in-band deny with a helpful message.
 */
function blocksUnsignedGit(command: string): boolean {
  // Cheap reject for the overwhelmingly common non-git Bash call before splitting.
  if (!command.includes("git")) return false;
  return command.split(/&&|\|\||[;\n|]/).some((segment) => {
    const sub = gitSubcommand(segment);
    return sub === "commit" || sub === "push";
  });
}

/**
 * Cloud-only guard: blocks raw `git commit` / `git push` so unsigned commits
 * cannot leave the sandbox. The agent must use the `git_signed_commit` tool,
 * which creates GitHub-signed (Verified) commits via the API.
 */
export const createSignedCommitGuardHook =
  (
    logger: Logger,
    onEnsureLocalToolsConnected?: () => Promise<boolean>,
  ): HookCallback =>
  async (input: HookInput, _toolUseID: string | undefined) => {
    if (input.hook_event_name !== "PreToolUse") return { continue: true };
    if (input.tool_name !== "Bash") return { continue: true };

    const command = (input.tool_input as { command?: string } | undefined)
      ?.command;
    if (!command || !blocksUnsignedGit(command)) {
      return { continue: true };
    }

    logger.info(
      `[SignedCommitGuard] Blocking unsigned git command: ${command}`,
    );

    // Try to restore the server before denying; tailor the message to the result.
    let toolsAvailable = true;
    if (onEnsureLocalToolsConnected) {
      try {
        toolsAvailable = await onEnsureLocalToolsConnected();
      } catch {
        toolsAvailable = false;
      }
    }

    const reason = toolsAvailable
      ? "Commits must be signed: `git commit` and `git push` are disabled here. " +
        "Stage changes with `git add`, then call the `git_signed_commit` tool " +
        `(${SIGNED_COMMIT_QUALIFIED_TOOL_NAME}) with a \`message\` to create a signed ` +
        "commit on the branch."
      : "Commits must be signed, and the signed-commit tooling is momentarily " +
        "reconnecting, so it isn't available this instant. Your staged and unstaged " +
        "changes are safe in the working tree — nothing is lost. Wait a moment, then " +
        `call the \`git_signed_commit\` tool (${SIGNED_COMMIT_QUALIFIED_TOOL_NAME}) with a ` +
        "`message`; raw `git commit`/`git push` stay disabled.";

    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason: reason,
      },
    };
  };

export const createPreToolUseHook =
  (settingsManager: SettingsManager, logger: Logger): HookCallback =>
  async (input: HookInput, _toolUseID: string | undefined) => {
    if (input.hook_event_name !== "PreToolUse") {
      return { continue: true };
    }

    const toolName = input.tool_name;
    const toolInput = input.tool_input;
    const permissionCheck = settingsManager.checkPermission(
      toolName,
      toolInput,
    );

    if (permissionCheck.decision !== "ask") {
      logger.info(
        `[PreToolUseHook] Tool: ${toolName}, Decision: ${permissionCheck.decision}, Rule: ${permissionCheck.rule}`,
      );
    }

    // Defer destructive PostHog exec sub-tools to canUseTool so the
    // sub-tool gate can re-prompt. Returning `{ continue: true }` is
    // not enough — the SDK then falls back to its default permission
    // flow which re-checks the same allow rule. We must force "ask"
    // so the SDK invokes canUseTool.
    if (permissionCheck.decision === "allow" && isPostHogExecTool(toolName)) {
      const subTool = extractPostHogSubTool(toolInput);
      // Force "ask" (→ canUseTool) for destructive sub-tools AND for go-live
      // workflow tools, so a settings allow-rule can't skip either gate.
      if (
        subTool &&
        (isPostHogDestructiveSubTool(subTool) ||
          isPostHogAlwaysGatedSubTool(subTool))
      ) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "ask" as const,
            permissionDecisionReason: `PostHog sub-tool '${subTool}' requires explicit approval`,
          },
        };
      }
    }

    switch (permissionCheck.decision) {
      case "allow":
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "allow" as const,
            permissionDecisionReason: `Allowed by settings rule: ${permissionCheck.rule}`,
          },
        };
      case "deny":
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "deny" as const,
            permissionDecisionReason: `Denied by settings rule: ${permissionCheck.rule}`,
          },
        };
      default:
        return { continue: true };
    }
  };
