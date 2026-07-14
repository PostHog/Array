/**
 * The PostHog MCP exposes a single `exec` dispatcher tool that runs
 * subcommands like `call [--json] <tool-name> [json]`. Once the user approves
 * `mcp__posthog__exec` once, every subsequent call goes through silently —
 * including destructive ones. These helpers let `canUseTool` re-gate the
 * destructive subset (update/delete family) at sub-tool granularity.
 */

const POSTHOG_EXEC_TOOL_RE = /^mcp__posthog(?:_[^_]+)*__exec$/;

const POSTHOG_CALL_COMMAND_RE = /^\s*call\s+(?:--json\s+)?([a-zA-Z0-9_-]+)/;

const POSTHOG_DESTRUCTIVE_SUBTOOL_RE =
  /(^|-)(partial-update|update|delete|destroy)(-|$)/i;

// First-party writes to PostHog Code's own desktop-file-system artifacts (a
// channel's CONTEXT.md and its freeform canvases). These are the explicit,
// user-initiated output of a generation task — not the PostHog product data
// (flags/experiments/notebooks) the destructive gate exists to protect — so
// they don't need the extra per-call approval; they ride the same silent-allow
// path as create-family exec sub-tools. Exact names only: the broader
// desktop-file-system-{partial-update,destroy} sub-tools rename/delete whole
// channels and must stay gated.
const SANCTIONED_FIRSTPARTY_WRITE_SUBTOOLS = new Set([
  "desktop-file-system-instructions-partial-update", // CONTEXT.md publish
  "desktop-file-system-canvas-partial-update", // freeform canvas publish
]);

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
  if (SANCTIONED_FIRSTPARTY_WRITE_SUBTOOLS.has(subTool)) return false;
  return POSTHOG_DESTRUCTIVE_SUBTOOL_RE.test(subTool);
}
