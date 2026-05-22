import type { z } from "zod";

/**
 * A single general-purpose local MCP server hosts every tool registered here,
 * for both adapters: the Claude in-process SDK server and the Codex stdio
 * server. Adding a tool means adding one entry to `LOCAL_TOOLS` (see
 * `./index.ts`) — no per-tool server file or adapter wiring. The name appears
 * in tool ids as `mcp__posthog-code-tools__<tool>`.
 */
export const LOCAL_TOOLS_MCP_NAME = "posthog-code-tools";

/** Runtime context handed to every local tool's handler and gate. */
export interface LocalToolCtx {
  cwd: string;
  /** GitHub token available to the sandbox, if any. */
  token?: string;
  taskId?: string;
}

/** Minimal session-meta shape needed to gate tools (e.g. cloud-only). */
export interface LocalToolGateMeta {
  environment?: "local" | "cloud";
}

/**
 * MCP tool result shape. Carries an open index signature so the value is
 * assignable to either SDK's `CallToolResult` (the Claude SDK and the MCP SDK
 * both attach an open `_meta`).
 */
export interface LocalToolResult {
  content: { type: "text"; text: string }[];
  isError?: true;
  [key: string]: unknown;
}

/** Tool definition with its input schema's type preserved for the handler. */
export interface LocalToolDef<S extends z.ZodRawShape> {
  name: string;
  description: string;
  schema: S;
  /**
   * Keep the tool visible even though MCP tools are offloaded behind ToolSearch
   * by default in the Claude adapter (ENABLE_TOOL_SEARCH). Ignored by Codex.
   */
  alwaysLoad?: boolean;
  isEnabled(ctx: LocalToolCtx, meta: LocalToolGateMeta | undefined): boolean;
  handler(
    ctx: LocalToolCtx,
    args: z.infer<z.ZodObject<S>>,
  ): Promise<LocalToolResult>;
}

/** Schema-erased tool, the shape stored in the registry array. */
export interface LocalTool {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  alwaysLoad?: boolean;
  isEnabled(ctx: LocalToolCtx, meta: LocalToolGateMeta | undefined): boolean;
  handler(
    ctx: LocalToolCtx,
    args: Record<string, unknown>,
  ): Promise<LocalToolResult>;
}

/**
 * Registers a tool, preserving its schema's inferred type at the definition
 * site. The returned value erases the schema generic so tools of different
 * shapes can live in one array; the cast is sound because both MCP SDKs
 * validate `args` against `schema` before dispatching to the handler.
 */
export function defineLocalTool<S extends z.ZodRawShape>(
  def: LocalToolDef<S>,
): LocalTool {
  return def as unknown as LocalTool;
}

/** The qualified tool id as the model and tool guards see it. */
export function qualifiedLocalToolName(toolName: string): string {
  return `mcp__${LOCAL_TOOLS_MCP_NAME}__${toolName}`;
}
