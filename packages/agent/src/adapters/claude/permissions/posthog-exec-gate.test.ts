import { describe, expect, it } from "vitest";
import {
  extractPostHogSubTool,
  isPostHogAlwaysGatedSubTool,
  isPostHogDestructiveSubTool,
  isPostHogExecTool,
  isPostHogGoLiveToolCall,
} from "./posthog-exec-gate";

describe("isPostHogExecTool", () => {
  it("matches the bare posthog exec tool", () => {
    expect(isPostHogExecTool("mcp__posthog__exec")).toBe(true);
  });

  it("matches plugin-prefixed variants", () => {
    expect(isPostHogExecTool("mcp__posthog_posthog__exec")).toBe(true);
    expect(isPostHogExecTool("mcp__posthog_cloud__exec")).toBe(true);
  });

  it("rejects other MCP tools", () => {
    expect(isPostHogExecTool("mcp__posthog__list")).toBe(false);
    expect(isPostHogExecTool("mcp__other__exec")).toBe(false);
    expect(isPostHogExecTool("mcp__acp__Bash")).toBe(false);
    expect(isPostHogExecTool("Bash")).toBe(false);
  });
});

describe("extractPostHogSubTool", () => {
  it("parses a bare `call <tool>` command", () => {
    expect(extractPostHogSubTool({ command: "call experiment-update" })).toBe(
      "experiment-update",
    );
  });

  it("parses `call --json <tool>`", () => {
    expect(
      extractPostHogSubTool({
        command: 'call --json experiment-update {"id":1}',
      }),
    ).toBe("experiment-update");
  });

  it("tolerates leading whitespace", () => {
    expect(extractPostHogSubTool({ command: "  call foo-delete" })).toBe(
      "foo-delete",
    );
  });

  it("returns null for non-`call` verbs", () => {
    expect(extractPostHogSubTool({ command: "tools" })).toBeNull();
    expect(extractPostHogSubTool({ command: "search experiments" })).toBeNull();
    expect(extractPostHogSubTool({ command: "info flag-get" })).toBeNull();
  });

  it("returns null for missing or malformed input", () => {
    expect(extractPostHogSubTool(undefined)).toBeNull();
    expect(extractPostHogSubTool(null)).toBeNull();
    expect(extractPostHogSubTool({})).toBeNull();
    expect(extractPostHogSubTool({ command: 42 })).toBeNull();
    expect(extractPostHogSubTool({ command: "" })).toBeNull();
  });
});

describe("isPostHogDestructiveSubTool", () => {
  it("matches update/delete/destroy/partial-update as whole segments", () => {
    expect(isPostHogDestructiveSubTool("experiment-update")).toBe(true);
    expect(isPostHogDestructiveSubTool("feature-flag-delete")).toBe(true);
    expect(isPostHogDestructiveSubTool("notebooks-destroy")).toBe(true);
    expect(isPostHogDestructiveSubTool("experiment-partial-update")).toBe(true);
    expect(isPostHogDestructiveSubTool("update-something")).toBe(true);
    expect(isPostHogDestructiveSubTool("delete")).toBe(true);
  });

  it("does not match read verbs or unrelated tokens", () => {
    expect(isPostHogDestructiveSubTool("experiment-get")).toBe(false);
    expect(isPostHogDestructiveSubTool("feature-flag-list")).toBe(false);
    expect(isPostHogDestructiveSubTool("experiment-create")).toBe(false);
    expect(isPostHogDestructiveSubTool("insights-pause")).toBe(false);
  });

  it("does not match substrings inside other words", () => {
    // "updated" should not count — must be a whole segment
    expect(isPostHogDestructiveSubTool("get-updated-events")).toBe(false);
    expect(isPostHogDestructiveSubTool("deleter-test")).toBe(false);
  });
});

describe("isPostHogAlwaysGatedSubTool", () => {
  it.each([
    "workflows-enable",
    "workflows-run-batch",
    "workflows-schedule-create",
    "workflows-update-schedule",
    "WORKFLOWS-ENABLE",
  ])("gates the go-live tool %s", (subTool) => {
    expect(isPostHogAlwaysGatedSubTool(subTool)).toBe(true);
  });

  it("does not gate other workflow or unrelated tools", () => {
    expect(isPostHogAlwaysGatedSubTool("workflows-create")).toBe(false);
    expect(isPostHogAlwaysGatedSubTool("workflows-test-run")).toBe(false);
    expect(isPostHogAlwaysGatedSubTool("workflows-patch-graph")).toBe(false);
    expect(isPostHogAlwaysGatedSubTool("workflows-blast-radius")).toBe(false);
    expect(isPostHogAlwaysGatedSubTool("experiment-update")).toBe(false);
  });

  // The whole reason this list exists: go-live tools carry no update/delete
  // token, so the destructive regex would let them through ungated.
  it("covers go-live tools the destructive regex misses", () => {
    for (const subTool of [
      "workflows-enable",
      "workflows-run-batch",
      "workflows-schedule-create",
    ]) {
      expect(isPostHogDestructiveSubTool(subTool)).toBe(false);
      expect(isPostHogAlwaysGatedSubTool(subTool)).toBe(true);
    }
    // workflows-update-schedule DOES contain "update", so it's caught by both -
    // that's fine, the go-live gate takes precedence in canUseTool.
    expect(isPostHogDestructiveSubTool("workflows-update-schedule")).toBe(true);
  });
});

describe("plugin-prefixed PostHog exec variants", () => {
  it("matches the plugin-installed server name", () => {
    // The renderer's POSTHOG_SERVER_RE recognizes plugin_posthog_* servers;
    // the gate must gate the same names or a plugin install skips it.
    expect(isPostHogExecTool("mcp__plugin_posthog_posthog__exec")).toBe(true);
    expect(isPostHogExecTool("mcp__plugin_posthog__exec")).toBe(true);
  });

  it("still rejects non-PostHog plugin servers", () => {
    expect(isPostHogExecTool("mcp__plugin_linear_linear__exec")).toBe(false);
    expect(isPostHogExecTool("mcp__pluginposthog__exec")).toBe(false);
  });
});

describe("isPostHogGoLiveToolCall", () => {
  it("classifies a Claude-shaped go-live call (legacy toolName meta)", () => {
    expect(
      isPostHogGoLiveToolCall({
        _meta: { claudeCode: { toolName: "mcp__posthog__exec" } },
        rawInput: { command: "call workflows-enable {}" },
      }),
    ).toBe(true);
  });

  it("classifies a Codex-shaped go-live call (structured mcp descriptor)", () => {
    expect(
      isPostHogGoLiveToolCall({
        _meta: { posthog: { mcp: { server: "posthog", tool: "exec" } } },
        rawInput: { command: "call --json workflows-run-batch {}" },
      }),
    ).toBe(true);
  });

  it("classifies a plugin-installed server's go-live call", () => {
    expect(
      isPostHogGoLiveToolCall({
        _meta: {
          posthog: { mcp: { server: "plugin_posthog_posthog", tool: "exec" } },
        },
        rawInput: { command: "call workflows-schedule-create {}" },
      }),
    ).toBe(true);
  });

  it("falls back to rawInput.toolName when meta carries no descriptor", () => {
    expect(
      isPostHogGoLiveToolCall({
        rawInput: {
          toolName: "mcp__posthog__exec",
          command: "call workflows-enable {}",
        },
      }),
    ).toBe(true);
  });

  it("rejects non-go-live sub-tools, other servers, and non-exec tools", () => {
    expect(
      isPostHogGoLiveToolCall({
        _meta: { posthog: { mcp: { server: "posthog", tool: "exec" } } },
        rawInput: { command: "call workflows-create {}" },
      }),
    ).toBe(false);
    expect(
      isPostHogGoLiveToolCall({
        _meta: { posthog: { mcp: { server: "linear", tool: "exec" } } },
        rawInput: { command: "call workflows-enable {}" },
      }),
    ).toBe(false);
    expect(
      isPostHogGoLiveToolCall({
        _meta: { posthog: { mcp: { server: "posthog", tool: "query" } } },
        rawInput: { command: "call workflows-enable {}" },
      }),
    ).toBe(false);
    expect(isPostHogGoLiveToolCall(undefined)).toBe(false);
    expect(isPostHogGoLiveToolCall({})).toBe(false);
  });
});
