import { describe, expect, it } from "vitest";
import { canvasNavIntentSchema } from "./freeformSchemas";

describe("canvasNavIntentSchema", () => {
  it.each([
    { target: "task", taskId: "t1" },
    { target: "new-task" },
    { target: "canvas", dashboardId: "d1" },
    { target: "new-canvas" },
    { target: "external", url: "https://posthog.com/insight/abc" },
    { target: "external", url: "http://example.com" },
    { target: "external", url: "mailto:support@posthog.com" },
  ])("accepts a valid intent: %o", (intent) => {
    expect(canvasNavIntentSchema.safeParse(intent).success).toBe(true);
  });

  // The url refine is the first scheme-validation layer: a disallowed scheme (or
  // a missing url) must be dropped before it can reach the host's browser open.
  it.each([
    {
      name: "javascript: scheme",
      intent: { target: "external", url: "javascript:alert(1)" },
    },
    {
      name: "file: scheme",
      intent: { target: "external", url: "file:///etc/passwd" },
    },
    {
      name: "custom deep-link scheme",
      intent: { target: "external", url: "ms-msdt://x" },
    },
    {
      name: "non-URL string",
      intent: { target: "external", url: "not a url" },
    },
    { name: "missing url", intent: { target: "external" } },
  ])("rejects $name", ({ intent }) => {
    expect(canvasNavIntentSchema.safeParse(intent).success).toBe(false);
  });
});
