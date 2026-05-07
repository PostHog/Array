import type { HookCallback, HookInput } from "@anthropic-ai/claude-agent-sdk";
import {
  enrichFileForAgent,
  type FileEnrichmentDeps,
} from "../../enrichment/file-enricher";
import type { Logger } from "../../utils/logger";
import { stripCatLineNumbers } from "./conversion/sdk-to-acp";
import {
  extractPostHogSubTool,
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

/**
 * Per-toolUseId handoff from the PostToolUse hook to `toolUpdateFromToolResult`.
 * Can't emit a standalone `tool_call_update` because the SDK emits its own
 * when it processes the tool_result, and the renderer applies it via
 * `Object.assign` — our earlier update would be overwritten.
 */
export type EnrichedReadCache = Map<string, string>;

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

export type OnModeChange = (mode: CodeExecutionMode) => Promise<void>;

interface CreatePostToolUseHookParams {
  onModeChange?: OnModeChange;
}

export const createPostToolUseHook =
  ({ onModeChange }: CreatePostToolUseHookParams): HookCallback =>
  async (
    input: HookInput,
    toolUseID: string | undefined,
  ): Promise<{ continue: boolean }> => {
    if (input.hook_event_name === "PostToolUse") {
      const toolName = input.tool_name;

      if (onModeChange && toolName === "EnterPlanMode") {
        await onModeChange("plan");
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
          delete toolUseCallbacks[toolUseID];
        } else {
          delete toolUseCallbacks[toolUseID];
        }
      }
    }
    return { continue: true };
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
      if (subTool && isPostHogDestructiveSubTool(subTool)) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "ask" as const,
            permissionDecisionReason: `Destructive PostHog sub-tool '${subTool}' requires explicit approval`,
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
