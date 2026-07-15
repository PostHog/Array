import { describe, expect, it } from "vitest";
import {
  parseMcpToolName,
  readAgentToolName,
  readMcpToolDescriptor,
  readMcpToolName,
} from "./tool-meta";

describe("parseMcpToolName", () => {
  it("splits the first __ after the prefix as the server boundary", () => {
    expect(parseMcpToolName("mcp__posthog__exec")).toEqual({
      server: "posthog",
      tool: "exec",
    });
  });

  it("keeps single underscores inside server and tool names", () => {
    expect(
      parseMcpToolName("mcp__plugin_posthog_posthog__execute-sql"),
    ).toEqual({ server: "plugin_posthog_posthog", tool: "execute-sql" });
  });

  it("returns undefined for non-MCP or malformed names", () => {
    expect(parseMcpToolName("Bash")).toBeUndefined();
    expect(parseMcpToolName("mcp__posthog__")).toBeUndefined();
    expect(parseMcpToolName("mcp____exec")).toBeUndefined();
  });
});

describe("readAgentToolName", () => {
  it("prefers the posthog channel over the legacy claudeCode fallback", () => {
    expect(
      readAgentToolName({
        posthog: { toolName: "mcp__posthog__exec" },
        claudeCode: { toolName: "stale" },
      }),
    ).toBe("mcp__posthog__exec");
  });

  it("falls back to claudeCode when posthog is absent", () => {
    expect(readAgentToolName({ claudeCode: { toolName: "Bash" } })).toBe(
      "Bash",
    );
  });

  it("returns undefined for non-tool meta", () => {
    expect(readAgentToolName(undefined)).toBeUndefined();
    expect(readAgentToolName({})).toBeUndefined();
  });
});

describe("readMcpToolDescriptor / readMcpToolName", () => {
  it("uses the structured mcp descriptor when present (no name parsing)", () => {
    const meta = {
      posthog: {
        toolName: "ignored",
        mcp: { server: "posthog", tool: "exec" },
      },
    };
    expect(readMcpToolDescriptor(meta)).toEqual({
      server: "posthog",
      tool: "exec",
    });
    expect(readMcpToolName(meta)).toBe("mcp__posthog__exec");
  });

  it("parses the legacy claudeCode mcp__ name when there is no structured channel", () => {
    const meta = { claudeCode: { toolName: "mcp__posthog__execute-sql" } };
    expect(readMcpToolDescriptor(meta)).toEqual({
      server: "posthog",
      tool: "execute-sql",
    });
    expect(readMcpToolName(meta)).toBe("mcp__posthog__execute-sql");
  });

  it("returns undefined for non-MCP tool calls", () => {
    expect(
      readMcpToolDescriptor({ claudeCode: { toolName: "Bash" } }),
    ).toBeUndefined();
    expect(readMcpToolName({ posthog: { toolName: "Bash" } })).toBeUndefined();
  });
});
