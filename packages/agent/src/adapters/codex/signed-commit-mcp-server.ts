/**
 * Standalone stdio MCP server exposing `git_signed_commit` to the Codex adapter.
 *
 * Spawned by codex-acp as an MCP server process. Reads its context (cwd, taskId,
 * token) from the base64-encoded POSTHOG_SIGNED_COMMIT_CTX env var and delegates
 * to the runtime-agnostic core in `@posthog/git/signed-commit` — the same logic
 * the Claude adapter calls in-process.
 *
 * Usage:
 *   POSTHOG_SIGNED_COMMIT_CTX=<base64> node signed-commit-mcp-server.js
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  readGithubTokenFromEnv,
  type SignedCommitCtx,
} from "@posthog/git/signed-commit";
import {
  runSignedCommitTool,
  SIGNED_COMMIT_MCP_NAME,
  SIGNED_COMMIT_TOOL_DESCRIPTION,
  SIGNED_COMMIT_TOOL_NAME,
  signedCommitToolSchema,
} from "../signed-commit-shared";

function die(message: string): never {
  process.stderr.write(`[signed-commit-mcp-server] ${message}\n`);
  process.exit(1);
}

const ctxEnv = process.env.POSTHOG_SIGNED_COMMIT_CTX;
if (!ctxEnv) {
  die("POSTHOG_SIGNED_COMMIT_CTX env var is required");
}

let parsed: { cwd: string; taskId?: string; token?: string };
try {
  parsed = JSON.parse(Buffer.from(ctxEnv, "base64").toString("utf-8"));
} catch (err) {
  die(
    `Failed to parse POSTHOG_SIGNED_COMMIT_CTX as base64-encoded JSON: ${err}`,
  );
}

const token = parsed.token ?? readGithubTokenFromEnv() ?? "";
if (!parsed.cwd || !token) {
  die(
    "POSTHOG_SIGNED_COMMIT_CTX must include cwd, and a token must be available",
  );
}

const ctx: SignedCommitCtx = {
  cwd: parsed.cwd,
  token,
  taskId: parsed.taskId,
};

const server = new McpServer({
  name: SIGNED_COMMIT_MCP_NAME,
  version: "1.0.0",
});

server.tool(
  SIGNED_COMMIT_TOOL_NAME,
  SIGNED_COMMIT_TOOL_DESCRIPTION,
  signedCommitToolSchema,
  async (args) => runSignedCommitTool(ctx, args),
);

const transport = new StdioServerTransport();
await server.connect(transport);
