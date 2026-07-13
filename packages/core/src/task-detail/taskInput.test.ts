import { describe, expect, it } from "vitest";
import { prepareTaskInput } from "./taskInput";

describe("prepareTaskInput", () => {
  // The isCloud guard on customInstructions is the only thing preventing
  // double-injection: local tasks already receive personalization via the
  // workspace-server system prompt, so the field must be dropped for them and
  // only passed through for cloud.
  it.each([
    { workspaceMode: "cloud" as const, expected: "Always use tabs." },
    { workspaceMode: "local" as const, expected: undefined },
    { workspaceMode: "worktree" as const, expected: undefined },
  ])(
    "passes customInstructions through only for cloud (%s)",
    ({ workspaceMode, expected }) => {
      const input = prepareTaskInput("do the thing", [], {
        workspaceMode,
        customInstructions: "Always use tabs.",
      });
      expect(input.customInstructions).toBe(expected);
    },
  );

  it("drops customInstructions for cloud when none is set", () => {
    const input = prepareTaskInput("do the thing", [], {
      workspaceMode: "cloud",
    });
    expect(input.customInstructions).toBeUndefined();
  });
});
