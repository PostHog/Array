/**
 * Builds the stdio local-tools MCP server config to inject into a Codex
 * app-server thread's `config.mcp_servers`. Ported from the codex-acp adapter
 * (`adapters/codex/codex-agent.ts` buildLocalToolsMcpServer + applyLocalTools +
 * enabledLocalTools gating).
 *
 * The two adapters share the SAME bundled stdio server script
 * (`adapters/codex/local-tools-mcp-server.js`), the SAME registry
 * (`adapters/local-tools`), and the SAME `LocalToolCtx`. Only the injection
 * boundary differs: codex-acp pushes an `McpServerStdio` into `newSession`'s
 * `mcpServers`, whereas the app-server adapter passes the result through
 * `toCodexMcpServers` into the thread config. We return the ACP `McpServerStdio`
 * shape so the existing translation layer stays the single owner of the
 * ACP -> Codex map.
 */

import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { McpServerStdio } from "@agentclientprotocol/sdk";
import { ghTokenEnv } from "@posthog/git/signed-commit";
import { resolveGithubToken } from "../../utils/github-token";
import {
  enabledLocalTools,
  LOCAL_TOOLS_MCP_NAME,
  type LocalToolCtx,
  type LocalToolGateMeta,
} from "../local-tools";
import { resolveTaskId } from "../session-meta";

/**
 * Gate inputs the local-tools server needs beyond what `LocalToolGateMeta`
 * carries: the task id (top-level or nested under `persistence`) and the base
 * branch the signed-git tools default to. Kept self-contained so this module
 * does not depend on the hub agent's session-meta type.
 */
export interface LocalToolsMeta extends LocalToolGateMeta {
  taskId?: string;
  persistence?: { taskId?: string };
  baseBranch?: string;
}

/**
 * Path resolves relative to the compiled adapter location. When bundled into
 * different entry points (dist/agent.js, dist/server/bin.cjs, etc), the
 * adapter sits at different depths, so walk up until we find the shared dist
 * asset. Mirrors `resolveBundledMcpScript` in the codex-acp adapter.
 */
function resolveBundledMcpScript(rel: string): string {
  let dir = import.meta.dirname ?? __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = resolvePath(dir, rel);
    if (existsSync(candidate)) return candidate;
    dir = resolvePath(dir, "..");
  }
  throw new Error(
    `Could not locate ${rel} relative to ${import.meta.dirname ?? __dirname}.`,
  );
}

function toMcpServerStdio(
  ctx: LocalToolCtx,
  enabledNames: string[],
): McpServerStdio {
  const scriptPath = resolveBundledMcpScript(
    "adapters/codex/local-tools-mcp-server.js",
  );
  const ctxBase64 = Buffer.from(JSON.stringify(ctx)).toString("base64");
  const env = [
    { name: "POSTHOG_LOCAL_TOOLS_CTX", value: ctxBase64 },
    { name: "POSTHOG_LOCAL_TOOLS_ENABLED", value: enabledNames.join(",") },
  ];
  if (ctx.token) {
    // Token also on the child env so its own git remote ops (fetch/ls-remote)
    // authenticate; the var names come from the single shared source.
    env.push(
      ...Object.entries(ghTokenEnv(ctx.token)).map(([name, value]) => ({
        name,
        value,
      })),
    );
  }
  return {
    name: LOCAL_TOOLS_MCP_NAME,
    command: process.execPath,
    args: [scriptPath],
    env,
  };
}

/**
 * Returns the local-tools stdio server config to inject, or null when no tool's
 * gate passes (e.g. local/desktop run with no GH token — signed-git tools are
 * cloud-only). Tools self-gate via the registry; the server is only injected
 * when at least one passes. Their instructions already live in the shared cloud
 * system prompt, so only the server config needs returning here.
 */
export function buildLocalToolsServer(
  ctx: { cwd?: string },
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
    baseBranch: meta?.baseBranch,
  };
  const tools = enabledLocalTools(toolCtx, meta);
  if (tools.length === 0) {
    return null;
  }
  return toMcpServerStdio(
    toolCtx,
    tools.map((t) => t.name),
  );
}
