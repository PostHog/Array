/**
 * The PostHog MCP exposes a single `exec` dispatcher tool that runs
 * subcommands like `call [--json] <tool-name> [json]`. Once the user approves
 * `mcp__posthog__exec` once, every subsequent call goes through silently —
 * including destructive ones. These helpers let `canUseTool` re-gate the
 * destructive subset (update/delete family) at sub-tool granularity.
 */

const POSTHOG_EXEC_TOOL_RE = /^mcp__posthog(?:_[^_]+)*__exec$/;

const POSTHOG_CALL_COMMAND_RE = /^\s*call\s+(?:--json\s+)?([a-zA-Z0-9_-]+)/;

// Captures the raw argument payload after `call [--json] <sub-tool>` so the gate
// can read the target `id` a sanctioned publish is aiming at.
const POSTHOG_CALL_ARGS_RE =
  /^\s*call\s+(?:--json\s+)?[a-zA-Z0-9_-]+\s+([\s\S]+)$/;

const POSTHOG_DESTRUCTIVE_SUBTOOL_RE =
  /(^|-)(partial-update|update|delete|destroy)(-|$)/i;

// First-party writes to PostHog Code's own desktop-file-system artifacts — a
// channel's CONTEXT.md and its freeform canvases, both stored in PostHog and
// published via these `*-partial-update` sub-tools. They are destructive like
// any other partial-update, but a generation task is *expected* to publish one,
// so the permission handler skips the extra approval for them — BUT only when
// the call targets the exact artifact id the task was authorized (by its own
// app-authored prompt) to write. Exact names only: the broader
// desktop-file-system-{partial-update,destroy} sub-tools rename/delete whole
// channels and stay fully gated.
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
  return POSTHOG_DESTRUCTIVE_SUBTOOL_RE.test(subTool);
}

export function isSanctionedFirstPartyWriteSubTool(subTool: string): boolean {
  return SANCTIONED_FIRSTPARTY_WRITE_SUBTOOLS.has(subTool);
}

// Reads the top-level string `id` from a PostHog exec `call` command's JSON
// args, or null if absent/malformed. Used to check that a sanctioned publish
// targets the artifact the task is authorized to write; null fails safe by
// leaving the call on the normal approval path.
export function extractPostHogCallId(toolInput: unknown): string | null {
  if (!toolInput || typeof toolInput !== "object") return null;
  const command = (toolInput as { command?: unknown }).command;
  if (typeof command !== "string") return null;
  const rawArgs = command.match(POSTHOG_CALL_ARGS_RE)?.[1]?.trim();
  if (!rawArgs) return null;
  try {
    const parsed: unknown = JSON.parse(rawArgs);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { id?: unknown }).id === "string"
    ) {
      return (parsed as { id: string }).id;
    }
  } catch {
    // Non-JSON / malformed args → no id; caller falls back to approval.
  }
  return null;
}
