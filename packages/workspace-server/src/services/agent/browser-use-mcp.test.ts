import { describe, expect, it } from "vitest";
import { BROWSER_USE_MCP_NAME, buildBrowserUseServer } from "./browser-use-mcp";

describe("buildBrowserUseServer", () => {
  it.each([
    { enabled: false, environment: "local" as const },
    { enabled: true, environment: "cloud" as const },
    { enabled: undefined, environment: "local" as const },
  ])("returns null for $enabled in $environment", (input) => {
    expect(buildBrowserUseServer(input.enabled, input.environment)).toBeNull();
  });

  it("builds an isolated Chrome MCP server for local sessions", () => {
    const server = buildBrowserUseServer(true, "local");

    expect(server).toMatchObject({
      name: BROWSER_USE_MCP_NAME,
      command: process.execPath,
      args: expect.arrayContaining([
        "--browser",
        "chrome",
        "--isolated",
        "vision",
      ]),
      env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
    });
    expect(server?.args[0]).toMatch(/@playwright[\\/]mcp[\\/]cli\.js$/);
  });
});
