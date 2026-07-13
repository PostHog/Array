import type { McpServer } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { toCodexMcpServers } from "./mcp-config";

describe("toCodexMcpServers", () => {
  it("returns undefined for empty input", () => {
    expect(toCodexMcpServers(undefined)).toBeUndefined();
    expect(toCodexMcpServers([])).toBeUndefined();
  });

  it("translates a stdio server, folding env pairs into a map", () => {
    const servers = [
      {
        name: "posthog",
        command: "node",
        args: ["server.js"],
        env: [
          { name: "TOKEN", value: "abc" },
          { name: "BASE", value: "http://x" },
        ],
      },
    ] as unknown as McpServer[];

    expect(toCodexMcpServers(servers)).toEqual({
      posthog: {
        command: "node",
        args: ["server.js"],
        env: { TOKEN: "abc", BASE: "http://x" },
      },
    });
  });

  it("omits env when there are no pairs", () => {
    const servers = [
      { name: "bare", command: "run", args: [], env: [] },
    ] as unknown as McpServer[];

    expect(toCodexMcpServers(servers)).toEqual({
      bare: { command: "run", args: [] },
    });
  });

  it("translates an http server, folding headers into http_headers", () => {
    const servers = [
      {
        type: "http",
        name: "remote",
        url: "https://mcp.example/mcp",
        headers: [{ name: "Authorization", value: "Bearer t" }],
      },
    ] as unknown as McpServer[];

    expect(toCodexMcpServers(servers)).toEqual({
      remote: {
        url: "https://mcp.example/mcp",
        http_headers: { Authorization: "Bearer t" },
      },
    });
  });
});
