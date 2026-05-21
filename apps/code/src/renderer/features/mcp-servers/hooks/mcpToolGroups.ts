import type { McpInstallationTool } from "@renderer/api/posthogClient";

export type McpToolGroup = "read" | "write_delete";

const READ_VERBS = new Set([
  "fetch",
  "find",
  "get",
  "list",
  "lookup",
  "query",
  "read",
  "search",
  "view",
]);

const WRITE_DELETE_VERBS = new Set([
  "add",
  "archive",
  "assign",
  "close",
  "create",
  "delete",
  "edit",
  "execute",
  "remove",
  "run",
  "send",
  "set",
  "update",
  "upload",
]);

function firstVerb(value: string | null | undefined): string | null {
  const [verb] =
    value
      ?.trim()
      .toLowerCase()
      .match(/[a-z]+/) ?? [];
  return verb ?? null;
}

function classifyVerb(verb: string | null): McpToolGroup | null {
  if (!verb) return null;
  if (READ_VERBS.has(verb)) return "read";
  if (WRITE_DELETE_VERBS.has(verb)) return "write_delete";
  return null;
}

export function getMcpToolGroup(tool: McpInstallationTool): McpToolGroup {
  return (
    classifyVerb(firstVerb(tool.tool_name)) ??
    classifyVerb(firstVerb(tool.display_name)) ??
    classifyVerb(firstVerb(tool.description)) ??
    "write_delete"
  );
}

export function groupMcpToolsByCapability(tools: McpInstallationTool[]): {
  read: McpInstallationTool[];
  write_delete: McpInstallationTool[];
} {
  return tools.reduce(
    (groups, tool) => {
      groups[getMcpToolGroup(tool)].push(tool);
      return groups;
    },
    { read: [], write_delete: [] } as {
      read: McpInstallationTool[];
      write_delete: McpInstallationTool[];
    },
  );
}
