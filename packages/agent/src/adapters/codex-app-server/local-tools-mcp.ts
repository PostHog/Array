/**
 * Builds the stdio local-tools MCP server config to inject into a Codex
 * app-server thread's `config.mcp_servers`.
 * Returns the ACP `McpServerStdio` shape so the existing translation layer stays
 * the single owner of the ACP→Codex map.
 */

import type { McpServerStdio } from "@agentclientprotocol/sdk";
import { resolveGithubToken } from "../../utils/github-token";
import {
  enabledLocalTools,
  type LocalToolCtx,
  type LocalToolGateMeta,
} from "../local-tools";
import { buildLocalToolsStdioServer } from "../local-tools/stdio-server";
import { resolveTaskId } from "../session-meta";

/**
 * Gate inputs the local-tools server needs beyond `LocalToolGateMeta`: the task id
 * and the base branch the signed-git tools default to. Self-contained so this
 * module doesn't depend on the hub agent's session-meta type.
 */
export interface LocalToolsMeta extends LocalToolGateMeta {
  taskId?: string;
  taskRunId?: string;
  persistence?: { taskId?: string };
  baseBranch?: string;
}

/**
 * Returns the local-tools stdio server config to inject, or null when no tool's
 * gate passes (e.g. local/desktop run with no GH token). Tools self-gate via the
 * registry; the server is only injected when at least one passes.
 */
export function buildLocalToolsServer(
  ctx: { cwd?: string; platform?: NodeJS.Platform },
  meta: LocalToolsMeta | undefined,
): McpServerStdio | null {
  const cwd = ctx.cwd;
  if (!cwd) {
    return null;
  }
  const toolCtx: LocalToolCtx = {
    cwd,
    token: resolveGithubToken(),
    taskId: resolveTaskId(meta),
    taskRunId: meta?.taskRunId,
    baseBranch: meta?.baseBranch,
    platform: ctx.platform ?? process.platform,
  };
  const tools = enabledLocalTools(toolCtx, meta);
  if (tools.length === 0) {
    return null;
  }
  const server = buildLocalToolsStdioServer(
    toolCtx,
    tools.map((t) => t.name),
  );
  return {
    ...server,
    env: Object.entries(server.env).map(([name, value]) => ({ name, value })),
  };
}
