import type { McpInstallationTool } from "@renderer/api/posthogClient";
import { describe, expect, it } from "vitest";
import { getMcpToolGroup, groupMcpToolsByCapability } from "./mcpToolGroups";

function tool(
  name: string,
  overrides: Partial<McpInstallationTool> = {},
): McpInstallationTool {
  return {
    id: `tool-${name}`,
    tool_name: name,
    display_name: name,
    description: "",
    input_schema: {},
    approval_state: "needs_approval",
    last_seen_at: "2026-01-01T00:00:00Z",
    removed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("getMcpToolGroup", () => {
  it("classifies clear read verbs from tool names", () => {
    expect(getMcpToolGroup(tool("get_ticket"))).toBe("read");
    expect(getMcpToolGroup(tool("list_projects"))).toBe("read");
    expect(getMcpToolGroup(tool("search_docs"))).toBe("read");
    expect(getMcpToolGroup(tool("lookup_customer"))).toBe("read");
  });

  it("classifies clear write and delete verbs from tool names", () => {
    expect(getMcpToolGroup(tool("create_ticket"))).toBe("write_delete");
    expect(getMcpToolGroup(tool("delete_file"))).toBe("write_delete");
    expect(getMcpToolGroup(tool("send_message"))).toBe("write_delete");
    expect(getMcpToolGroup(tool("run_query"))).toBe("write_delete");
  });

  it("falls back to display name and description when the tool name is ambiguous", () => {
    expect(
      getMcpToolGroup(
        tool("ticket", {
          display_name: "Find ticket",
        }),
      ),
    ).toBe("read");
    expect(
      getMcpToolGroup(
        tool("message", {
          display_name: "Message",
          description: "Send a message to the current channel",
        }),
      ),
    ).toBe("write_delete");
  });

  it("defaults ambiguous tools to write/delete for safety", () => {
    expect(getMcpToolGroup(tool("ticket"))).toBe("write_delete");
  });
});

describe("groupMcpToolsByCapability", () => {
  it("groups tools while preserving their input order within each group", () => {
    const tools = [
      tool("create_ticket"),
      tool("get_ticket"),
      tool("search_tickets"),
      tool("update_ticket"),
    ];

    expect(groupMcpToolsByCapability(tools)).toEqual({
      read: [tools[1], tools[2]],
      write_delete: [tools[0], tools[3]],
    });
  });
});
