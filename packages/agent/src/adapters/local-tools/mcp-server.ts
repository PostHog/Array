/**
 * Standalone stdio MCP server exposing the general local tools to agent runtimes.
 * It reads its context from POSTHOG_LOCAL_TOOLS_CTX and its enabled tool set from
 * POSTHOG_LOCAL_TOOLS_ENABLED, then registers the corresponding registry tools.
 *
 * Usage:
 *   POSTHOG_LOCAL_TOOLS_CTX=<base64> \
 *   POSTHOG_LOCAL_TOOLS_ENABLED=git_signed_commit \
 *     node mcp-server.js
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveGithubToken } from "../../utils/github-token";
import { LOCAL_TOOLS, LOCAL_TOOLS_MCP_NAME, type LocalToolCtx } from "./index";

function die(message: string): never {
  process.stderr.write(`[local-tools-mcp-server] ${message}\n`);
  process.exit(1);
}

const ctxEnv = process.env.POSTHOG_LOCAL_TOOLS_CTX;
if (!ctxEnv) {
  die("POSTHOG_LOCAL_TOOLS_CTX env var is required");
}

let parsed: {
  cwd: string;
  taskId?: string;
  taskRunId?: string;
  baseBranch?: string;
};
try {
  parsed = JSON.parse(Buffer.from(ctxEnv, "base64").toString("utf-8"));
} catch (err) {
  die(`Failed to parse POSTHOG_LOCAL_TOOLS_CTX as base64-encoded JSON: ${err}`);
}

if (!parsed.cwd) {
  die("POSTHOG_LOCAL_TOOLS_CTX must include cwd");
}

const ctx: LocalToolCtx = {
  cwd: parsed.cwd,
  token: resolveGithubToken(),
  taskId: parsed.taskId,
  taskRunId: parsed.taskRunId,
  baseBranch: parsed.baseBranch,
};

const enabledNames = (process.env.POSTHOG_LOCAL_TOOLS_ENABLED ?? "")
  .split(",")
  .filter(Boolean);
const tools = LOCAL_TOOLS.filter((t) => enabledNames.includes(t.name));
if (tools.length === 0) {
  die("POSTHOG_LOCAL_TOOLS_ENABLED listed no known tools");
}

const server = new McpServer({
  name: LOCAL_TOOLS_MCP_NAME,
  version: "1.0.0",
});

for (const t of tools) {
  server.tool(t.name, t.description, t.schema, async (args) =>
    t.handler(ctx, args),
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
