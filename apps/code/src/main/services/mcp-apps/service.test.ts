import {
  LEGACY_RESOURCE_URI_META_KEY,
  McpAppsServiceEvent,
  type McpAppsToolCallUiDiscoveredEvent,
  POSTHOG_EXEC_TOOL_KEY,
} from "@shared/types/mcp-apps";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { McpAppsService } from "./service";

function makeService(): McpAppsService {
  const urlLauncher = { launch: vi.fn() };
  return new McpAppsService(urlLauncher as never);
}

describe("McpAppsService — per-call exec UI", () => {
  let service: McpAppsService;

  beforeEach(() => {
    service = makeService();
  });

  it("registers a per-call association from a modern _meta.ui.resourceUri", () => {
    const events: McpAppsToolCallUiDiscoveredEvent[] = [];
    service.on(McpAppsServiceEvent.ToolCallUiDiscovered, (e) => events.push(e));

    service.notifyToolResult(POSTHOG_EXEC_TOOL_KEY, "call-1", {
      content: [{ type: "text", text: "{}" }],
      _meta: { ui: { resourceUri: "ui://posthog/insight" } },
    });

    expect(service.hasUiForToolCall("call-1")).toBe(true);
    expect(events).toEqual([
      {
        toolCallId: "call-1",
        toolKey: POSTHOG_EXEC_TOOL_KEY,
        resourceUri: "ui://posthog/insight",
      },
    ]);
  });

  it("supports the legacy flat resourceUri key", () => {
    service.notifyToolResult(POSTHOG_EXEC_TOOL_KEY, "call-legacy", {
      _meta: { [LEGACY_RESOURCE_URI_META_KEY]: "ui://posthog/legacy" },
    });
    expect(service.hasUiForToolCall("call-legacy")).toBe(true);
  });

  it("does nothing for non-exec tools", () => {
    service.notifyToolResult("mcp__posthog__query", "call-2", {
      _meta: { ui: { resourceUri: "ui://posthog/insight" } },
    });
    expect(service.hasUiForToolCall("call-2")).toBe(false);
  });

  it("ignores errored exec results", () => {
    service.notifyToolResult(
      POSTHOG_EXEC_TOOL_KEY,
      "call-3",
      { _meta: { ui: { resourceUri: "ui://posthog/insight" } } },
      true,
    );
    expect(service.hasUiForToolCall("call-3")).toBe(false);
  });

  it("ignores exec results without a UI resource", () => {
    service.notifyToolResult(POSTHOG_EXEC_TOOL_KEY, "call-4", {
      content: [{ type: "text", text: "no ui here" }],
    });
    expect(service.hasUiForToolCall("call-4")).toBe(false);
  });

  it("does not emit twice for the same call", () => {
    const events: McpAppsToolCallUiDiscoveredEvent[] = [];
    service.on(McpAppsServiceEvent.ToolCallUiDiscovered, (e) => events.push(e));

    const result = { _meta: { ui: { resourceUri: "ui://posthog/insight" } } };
    service.notifyToolResult(POSTHOG_EXEC_TOOL_KEY, "call-5", result);
    service.notifyToolResult(POSTHOG_EXEC_TOOL_KEY, "call-5", result);

    expect(events).toHaveLength(1);
  });

  it("evicts the association when the call is cancelled", () => {
    service.notifyToolResult(POSTHOG_EXEC_TOOL_KEY, "call-6", {
      _meta: { ui: { resourceUri: "ui://posthog/insight" } },
    });
    expect(service.hasUiForToolCall("call-6")).toBe(true);

    service.notifyToolCancelled(POSTHOG_EXEC_TOOL_KEY, "call-6");
    expect(service.hasUiForToolCall("call-6")).toBe(false);
  });
});
