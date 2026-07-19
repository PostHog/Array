import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { McpServerStdio } from "@agentclientprotocol/sdk";

export const BROWSER_USE_MCP_NAME = "playwright";
const require = createRequire(import.meta.url);

function resolvePlaywrightMcpCli(): string {
  const packageJson = require.resolve("@playwright/mcp/package.json");
  const cli = join(dirname(packageJson), "cli.js");
  if (!existsSync(cli)) {
    throw new Error(`Playwright MCP CLI not found at ${cli}`);
  }
  return cli;
}

export function buildBrowserUseServer(
  enabled: boolean | undefined,
  environment: "local" | "cloud",
): McpServerStdio | null {
  if (!enabled || environment !== "local") return null;

  return {
    name: BROWSER_USE_MCP_NAME,
    command: process.execPath,
    args: [
      resolvePlaywrightMcpCli(),
      "--browser",
      "chrome",
      "--isolated",
      "--caps",
      "vision",
      "--codegen",
      "none",
      "--image-responses",
      "omit",
      "--output-mode",
      "stdout",
    ],
    env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
  };
}
