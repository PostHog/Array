import type {
  ToolKind as AcpToolKind,
  SessionUpdate,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
} from "@agentclientprotocol/sdk";

export type CodeToolKind = AcpToolKind | "question";

export type {
  SessionUpdate,
  ToolCallContent,
  ToolCallStatus,
  ToolCallLocation,
};

export interface ToolCall {
  _meta?: { [key: string]: unknown } | null;
  content?: ToolCallContent[];
  kind?: CodeToolKind | null;
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
  status?: ToolCallStatus | null;
  title: string;
  toolCallId: string;
}

export type Plan = Extract<SessionUpdate, { sessionUpdate: "plan" }>;
export type ConfigOptionUpdate = Extract<
  SessionUpdate,
  { sessionUpdate: "config_option_update" }
>;
