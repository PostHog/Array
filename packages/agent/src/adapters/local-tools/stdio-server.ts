import { ghTokenEnv } from "@posthog/git/signed-commit";
import { resolveBundledMcpScript } from "../../utils/resolve-bundled-script";
import {
  LOCAL_TOOLS_MCP_NAME,
  type LocalToolCtx,
  type LocalToolGateMeta,
} from "./registry";
import { computerUseTools } from "./tools/computer-use";

export interface LocalToolsStdioServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function buildLocalToolsStdioServer(
  ctx: LocalToolCtx,
  enabledNames: string[],
): LocalToolsStdioServer {
  const scriptPath = resolveBundledMcpScript(
    "adapters/codex-app-server/local-tools-mcp-server.js",
  );
  const env: Record<string, string> = {
    POSTHOG_LOCAL_TOOLS_CTX: Buffer.from(JSON.stringify(ctx)).toString(
      "base64",
    ),
    POSTHOG_LOCAL_TOOLS_ENABLED: enabledNames.join(","),
    ELECTRON_RUN_AS_NODE: "1",
  };
  if (ctx.token) {
    Object.assign(env, ghTokenEnv(ctx.token));
  }
  return {
    name: LOCAL_TOOLS_MCP_NAME,
    command: process.execPath,
    args: [scriptPath],
    env,
  };
}

export function buildComputerUseStdioServer(
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): LocalToolsStdioServer | null {
  const ctx: LocalToolCtx = { cwd, platform };
  const meta: LocalToolGateMeta = {
    environment: "local",
    computerUse: true,
  };
  const tools = computerUseTools.filter((tool) => tool.isEnabled(ctx, meta));
  if (tools.length === 0) return null;
  return buildLocalToolsStdioServer(
    ctx,
    tools.map((tool) => tool.name),
  );
}
