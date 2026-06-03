export {
  CODE_EXECUTION_MODES,
  type CodeExecutionMode,
  getAvailableModes,
  type ModeInfo,
} from "../../execution-mode";

import type { CodeExecutionMode } from "../../execution-mode";
import { isMcpToolReadOnly } from "./mcp/tool-metadata";

export const READ_TOOLS: Set<string> = new Set(["Read", "NotebookRead"]);

export const WRITE_TOOLS: Set<string> = new Set([
  "Edit",
  "Write",
  "NotebookEdit",
]);

export const BASH_TOOLS: Set<string> = new Set([
  "Bash",
  "BashOutput",
  "KillShell",
]);

export const SEARCH_TOOLS: Set<string> = new Set(["Glob", "Grep", "LS"]);

export const WEB_TOOLS: Set<string> = new Set(["WebSearch", "WebFetch"]);

export const AGENT_TOOLS: Set<string> = new Set([
  "Task",
  "Agent",
  "TaskCreate",
  "TaskUpdate",
  "TaskGet",
  "TaskList",
]);

const BASE_ALLOWED_TOOLS = [
  ...READ_TOOLS,
  ...SEARCH_TOOLS,
  ...WEB_TOOLS,
  ...AGENT_TOOLS,
];

const AUTO_ALLOWED_TOOLS: Record<string, Set<string>> = {
  auto: new Set(BASE_ALLOWED_TOOLS),
  default: new Set(BASE_ALLOWED_TOOLS),
  acceptEdits: new Set([...BASE_ALLOWED_TOOLS, ...WRITE_TOOLS]),
  plan: new Set(BASE_ALLOWED_TOOLS),
};

export function isToolAllowedForMode(
  toolName: string,
  mode: CodeExecutionMode,
): boolean {
  if (mode === "bypassPermissions") {
    return true;
  }
  if (AUTO_ALLOWED_TOOLS[mode]?.has(toolName) === true) {
    return true;
  }
  if (isMcpToolReadOnly(toolName)) {
    return true;
  }
  return false;
}
