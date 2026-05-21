import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import type { SignedCommitCtx } from "@posthog/git/signed-commit";
import {
  runSignedCommitTool,
  SIGNED_COMMIT_MCP_NAME,
  SIGNED_COMMIT_TOOL_DESCRIPTION,
  SIGNED_COMMIT_TOOL_NAME,
  signedCommitToolSchema,
} from "../../signed-commit-shared";

export { SIGNED_COMMIT_MCP_NAME };

/**
 * In-process SDK MCP server exposing `git_signed_commit` to the Claude adapter.
 * Wraps the runtime-agnostic core in `@posthog/git/signed-commit`. Registered
 * per cloud session in `claude-agent.ts`.
 */
export function createSignedCommitMcpServer(
  ctx: SignedCommitCtx,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: SIGNED_COMMIT_MCP_NAME,
    version: "1.0.0",
    tools: [
      tool(
        SIGNED_COMMIT_TOOL_NAME,
        SIGNED_COMMIT_TOOL_DESCRIPTION,
        signedCommitToolSchema,
        async (args) => runSignedCommitTool(ctx, args),
        // Keep the tool in context even though MCP tools are offloaded behind
        // ToolSearch by default (ENABLE_TOOL_SEARCH) — committing is core to
        // cloud tasks, so the agent must always see it.
        { alwaysLoad: true },
      ),
    ],
  });
}
