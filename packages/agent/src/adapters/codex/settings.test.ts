import { describe, expect, it, vi } from "vitest";

const readFileSync = vi.hoisted(() => vi.fn());
vi.mock("node:fs", () => ({ readFileSync }));

const { CodexSettingsManager } = await import("./settings");

function serverNamesFor(toml: string): string[] {
  readFileSync.mockReturnValue(toml);
  return new CodexSettingsManager("/repo").getSettings().mcpServerNames.sort();
}

describe("CodexSettingsManager MCP server names", () => {
  // Regression: a `[mcp_servers.<name>.env]` table was treated as its own
  // server, so the spawn emitted `mcp_servers.<name>.env.enabled=false`, which
  // sets a boolean on codex's string-typed env map. codex-acp then rejected the
  // whole config, crashed the session, and the host silently ran Claude/Opus.
  it("collapses nested mcp_servers sub-tables to the parent server name", () => {
    expect(
      serverNamesFor(
        [
          "[mcp_servers.node_repl]",
          'command = "node"',
          "[mcp_servers.node_repl.env]",
          'FOO = "bar"',
          "[mcp_servers.other]",
          'command = "x"',
        ].join("\n"),
      ),
    ).toEqual(["node_repl", "other"]);
  });

  it("keeps the inner name for a quoted dotted server key", () => {
    expect(
      serverNamesFor(['[mcp_servers."my.server"]', 'command = "x"'].join("\n")),
    ).toEqual(["my.server"]);
  });

  it("returns no servers when none are declared", () => {
    expect(serverNamesFor('model = "gpt-5.5"')).toEqual([]);
  });
});
