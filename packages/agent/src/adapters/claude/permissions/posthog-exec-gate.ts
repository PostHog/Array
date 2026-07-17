import { readMcpToolDescriptor } from "@posthog/shared";

/**
 * The PostHog MCP exposes a single `exec` dispatcher tool that runs
 * subcommands like `call [--json] <tool-name> [json]`. Once the user approves
 * `mcp__posthog__exec` once, every subsequent call goes through silently —
 * including destructive ones. These helpers let `canUseTool` re-gate the
 * destructive subset (update/delete family) at sub-tool granularity.
 */

// Optional `plugin_` prefix + `posthog` + optional installation suffixes,
// mirroring the renderer's POSTHOG_SERVER_RE (posthog-exec-display.ts) so a
// plugin-installed server (`mcp__plugin_posthog_posthog__exec`) is gated the
// same as the built-in one.
const POSTHOG_SERVER_NAME_RE = /^(?:plugin_)?posthog(?:_[^_]+)*$/;

const POSTHOG_EXEC_TOOL_RE = /^mcp__(?:plugin_)?posthog(?:_[^_]+)*__exec$/;

const POSTHOG_CALL_COMMAND_RE = /^\s*call\s+(?:--json\s+)?([a-zA-Z0-9_-]+)/;

const POSTHOG_DESTRUCTIVE_SUBTOOL_RE =
  /(^|-)(partial-update|update|delete|destroy)(-|$)/i;

export function isPostHogExecTool(toolName: string): boolean {
  return POSTHOG_EXEC_TOOL_RE.test(toolName);
}

export function extractPostHogSubTool(toolInput: unknown): string | null {
  if (!toolInput || typeof toolInput !== "object") return null;
  const command = (toolInput as { command?: unknown }).command;
  if (typeof command !== "string") return null;
  const match = command.match(POSTHOG_CALL_COMMAND_RE);
  return match ? (match[1] ?? null) : null;
}

export function isPostHogDestructiveSubTool(subTool: string): boolean {
  return POSTHOG_DESTRUCTIVE_SUBTOOL_RE.test(subTool);
}

// Workflow "go live" tools: enabling a workflow or dispatching to a real
// audience. These must ALWAYS raise an approval card - even in auto mode, and
// even when a prior "always allow" was persisted - because sending to real
// people is the human's explicit call (the approve-&-publish gate). Kept as an
// explicit set (not folded into the destructive regex) because these names
// carry no update/delete token and the gate must not be persistable.
const POSTHOG_ALWAYS_GATED_SUBTOOLS = new Set([
  "workflows-enable",
  "workflows-run-batch",
  "workflows-schedule-create",
  "workflows-update-schedule",
]);

export function isPostHogAlwaysGatedSubTool(subTool: string): boolean {
  return POSTHOG_ALWAYS_GATED_SUBTOOLS.has(subTool.toLowerCase());
}

/**
 * Adapter-neutral: whether a permission request's tool call is a PostHog
 * go-live exec call. Claude marks these with `_meta.posthog.alwaysGated`, but
 * Codex forwards PostHog exec approvals without it — so the cloud relay also
 * classifies the call itself: the MCP descriptor (or legacy tool name) must be
 * a PostHog server's `exec`, and the command's sub-tool must be always-gated.
 */
export function isPostHogGoLiveToolCall(
  toolCall: { _meta?: unknown; rawInput?: unknown } | null | undefined,
): boolean {
  if (!toolCall) return false;
  const descriptor = readMcpToolDescriptor(toolCall._meta);
  const rawInput = toolCall.rawInput as { toolName?: unknown } | undefined;
  const rawName =
    typeof rawInput?.toolName === "string" ? rawInput.toolName : undefined;
  const isExec = descriptor
    ? descriptor.tool === "exec" &&
      POSTHOG_SERVER_NAME_RE.test(descriptor.server)
    : !!rawName && isPostHogExecTool(rawName);
  if (!isExec) return false;
  const subTool = extractPostHogSubTool(toolCall.rawInput);
  return !!subTool && isPostHogAlwaysGatedSubTool(subTool);
}
