/**
 * Minimal typings for the native Codex `app-server` JSON-RPC protocol.
 *
 * Spike scope: method names are taken from the documented app-server protocol
 * (`codex app-server`). Param/result shapes are intentionally loose until we
 * generate the exact schema from the pinned codex binary via
 * `codex app-server generate-ts`. Tighten these once the binary is bundled.
 *
 * See https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
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
} as const;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;
