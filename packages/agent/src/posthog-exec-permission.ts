/**
 * The PostHog MCP exposes a single `exec` dispatcher tool that runs
 * subcommands like `call [--json] <tool-name> [json]`. These helpers identify
 * that dispatcher, extract the delegated tool, and apply the externally
 * configured permission regex at sub-tool granularity.
 */

const POSTHOG_EXEC_TOOL_RE = /^mcp__posthog(?:_[^_]+)*__exec$/;

const POSTHOG_CALL_COMMAND_RE = /^\s*call\s+(?:--json\s+)?([a-zA-Z0-9_-]+)/;

export const DEFAULT_POSTHOG_EXEC_PERMISSION_REGEX_SOURCE =
  "(^|-)(partial-update|update|patch|delete|destroy)(-|$)";

export function compilePostHogExecPermissionRegex(source: string): RegExp {
  return new RegExp(source, "i");
}

export function isPostHogExecTool(toolName: string): boolean {
  return POSTHOG_EXEC_TOOL_RE.test(toolName);
}

export function isPostHogExecDescriptor(descriptor: {
  server: string;
  tool: string;
}): boolean {
  return isPostHogExecTool(`mcp__${descriptor.server}__${descriptor.tool}`);
}

export function extractPostHogSubTool(toolInput: unknown): string | null {
  if (!toolInput || typeof toolInput !== "object") return null;
  const command = (toolInput as { command?: unknown }).command;
  if (typeof command !== "string") return null;
  const match = command.match(POSTHOG_CALL_COMMAND_RE);
  return match ? (match[1] ?? null) : null;
}

export function matchesPostHogExecPermission(
  subTool: string,
  permissionRegex: RegExp,
): boolean {
  permissionRegex.lastIndex = 0;
  return permissionRegex.test(subTool);
}
