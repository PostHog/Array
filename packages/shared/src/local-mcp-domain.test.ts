import { describe, expect, it } from "vitest";
import {
  parsePostHogMcpServers,
  validatePostHogMcpConfig,
} from "./local-mcp-domain";

describe("parsePostHogMcpServers", () => {
  it("validates the shared stdio and HTTP configuration", () => {
    expect(
      parsePostHogMcpServers({
        mcpServers: {
          command: {
            command: "npx",
            args: ["server"],
            env: { TOKEN: "secret" },
          },
          remote: {
            type: "http",
            url: "https://mcp.example.com",
            headers: { Authorization: "Bearer secret" },
          },
        },
      }),
    ).toEqual([
      {
        name: "command",
        config: {
          type: "stdio",
          command: "npx",
          args: ["server"],
          env: { TOKEN: "secret" },
        },
      },
      {
        name: "remote",
        config: {
          type: "http",
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer secret" },
        },
      },
    ]);
  });

  it.each([
    { name: "array root", value: [] },
    { name: "array server map", value: { mcpServers: [] } },
  ])("rejects an $name", ({ value }) => {
    expect(parsePostHogMcpServers(value)).toEqual([]);
  });

  it.each([
    { name: "unsupported transport", config: { type: "sse", url: "x" } },
    { name: "non-string argument", config: { command: "x", args: [1] } },
    { name: "non-string environment", config: { command: "x", env: { A: 1 } } },
    {
      name: "non-string header",
      config: { type: "http", url: "x", headers: { A: 1 } },
    },
  ])("retains the name of an invalid $name", ({ config }) => {
    expect(parsePostHogMcpServers({ mcpServers: { broken: config } })).toEqual([
      { name: "broken", config: null },
    ]);
  });
});

describe("validatePostHogMcpConfig", () => {
  it("reports invalid roots and named server entries", () => {
    expect(validatePostHogMcpConfig(null)).toEqual([
      "Configuration must be a JSON object",
    ]);
    expect(validatePostHogMcpConfig({ mcpServers: [] })).toEqual([
      "mcpServers must be an object",
    ]);
    expect(
      validatePostHogMcpConfig({
        mcpServers: { broken: { type: "sse", url: "https://example.com" } },
      }),
    ).toEqual(["Invalid MCP server configuration: broken"]);
  });
});
