/**
 * Minimal typings for the native Codex `app-server` JSON-RPC protocol.
 *
 * Method names and message shapes follow the documented protocol
 * (https://developers.openai.com/codex/app-server). The wire framing is
 * newline-delimited JSON that follows JSON-RPC 2.0 structure but omits the
 * `"jsonrpc": "2.0"` header on the wire.
 *
 * Spike scope: param/result shapes are still partial. Generate the exact,
 * version-pinned schema with `codex app-server generate-ts` once the codex
 * binary is bundled, then tighten these.
 */

export const APP_SERVER_METHODS = {
  INITIALIZE: "initialize",
  THREAD_START: "thread/start",
  THREAD_RESUME: "thread/resume",
  THREAD_FORK: "thread/fork",
  TURN_START: "turn/start",
  // Inject input into the active turn instead of starting a new one — used to
  // mirror Claude's mid-turn steering. Fails unless `expectedTurnId` matches.
  TURN_STEER: "turn/steer",
  TURN_INTERRUPT: "turn/interrupt",
  MODEL_LIST: "model/list",
  SKILLS_LIST: "skills/list",
  THREAD_LIST: "thread/list",
} as const;

export const APP_SERVER_NOTIFICATIONS = {
  INITIALIZED: "initialized",
  THREAD_STARTED: "thread/started",
  // Carries the active turn id (`turn.id`) — captured as the turn/steer +
  // turn/interrupt precondition.
  TURN_STARTED: "turn/started",
  ITEM_STARTED: "item/started",
  ITEM_COMPLETED: "item/completed",
  AGENT_MESSAGE_DELTA: "item/agentMessage/delta",
  REASONING_TEXT_DELTA: "item/reasoning/textDelta",
  TURN_PLAN_UPDATED: "turn/plan/updated",
  TURN_COMPLETED: "turn/completed",
  // Fatal turn error; `willRetry:false` means it won't recover on its own.
  ERROR: "error",
  TOKEN_USAGE_UPDATED: "thread/tokenUsage/updated",
  // Streamed stdout/stderr chunks for an in-progress commandExecution item.
  COMMAND_OUTPUT_DELTA: "item/commandExecution/outputDelta",
  // PTY-level stdin echoed back for an interactive terminal command.
  TERMINAL_INTERACTION: "item/commandExecution/terminalInteraction",
  // Incremental patch/diff updates for an in-progress fileChange item.
  FILE_CHANGE_PATCH_UPDATED: "item/fileChange/patchUpdated",
} as const;

/**
 * Server-initiated requests the client must answer. The two approvals are
 * handled in handleApproval (yes/no decision). The richer requests carry
 * distinct response shapes, not the approval decision:
 *  - TOOL_USER_INPUT  — AskUserQuestion-style multi-question prompt.
 *  - PERMISSIONS_APPROVAL — grant a permission profile for a turn/session.
 *  - MCP_ELICITATION  — an MCP server asking the user for structured input.
 */
export const APP_SERVER_REQUESTS = {
  COMMAND_APPROVAL: "item/commandExecution/requestApproval",
  FILE_CHANGE_APPROVAL: "item/fileChange/requestApproval",
  TOOL_USER_INPUT: "item/tool/requestUserInput",
  PERMISSIONS_APPROVAL: "item/permissions/requestApproval",
  MCP_ELICITATION: "mcpServer/elicitation/request",
} as const;

/** JSON-RPC ids are `string | number` per the codex schema (`RequestId.ts`). */
export type RequestId = string | number;

export interface JsonRpcRequest {
  id: RequestId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  id: RequestId;
  result?: unknown;
  error?: JsonRpcError;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;
