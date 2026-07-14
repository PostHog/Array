import { describe, expect, it } from "vitest";
import {
  extractPostHogSubTool,
  isPostHogDestructiveSubTool,
  isPostHogExecTool,
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

  it("exempts sanctioned first-party desktop-file-system writes", () => {
    // A channel's CONTEXT.md and freeform canvases are the app's own artifacts,
    // not PostHog product data — they publish without the destructive gate.
    expect(
      isPostHogDestructiveSubTool(
        "desktop-file-system-instructions-partial-update",
      ),
    ).toBe(false);
    expect(
      isPostHogDestructiveSubTool("desktop-file-system-canvas-partial-update"),
    ).toBe(false);
  });

  it("still gates broader desktop-file-system mutations (exact-match, not prefix)", () => {
    // These rename/delete whole channels and must stay gated.
    expect(
      isPostHogDestructiveSubTool("desktop-file-system-partial-update"),
    ).toBe(true);
    expect(isPostHogDestructiveSubTool("desktop-file-system-destroy")).toBe(
      true,
    );
  });
});
