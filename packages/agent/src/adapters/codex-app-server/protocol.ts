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
  TURN_INTERRUPT: "turn/interrupt",
} as const;

export const APP_SERVER_NOTIFICATIONS = {
  INITIALIZED: "initialized",
  THREAD_STARTED: "thread/started",
  ITEM_STARTED: "item/started",
  ITEM_COMPLETED: "item/completed",
  AGENT_MESSAGE_DELTA: "item/agentMessage/delta",
  TURN_COMPLETED: "turn/completed",
  TOKEN_USAGE_UPDATED: "thread/tokenUsage/updated",
} as const;

/** Server-initiated requests the client must answer (approvals). */
export const APP_SERVER_REQUESTS = {
  COMMAND_APPROVAL: "item/commandExecution/requestApproval",
  FILE_CHANGE_APPROVAL: "item/fileChange/requestApproval",
} as const;

export interface JsonRpcRequest {
  id: number;
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
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;
