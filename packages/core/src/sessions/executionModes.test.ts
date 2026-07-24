import { describe, expect, it } from "vitest";
import { getAvailableModesForAdapter } from "./executionModes";

describe("getAvailableModesForAdapter", () => {
  it.each([
    ["claude", ["default", "acceptEdits", "plan", "bypassPermissions", "auto"]],
    ["codex", ["plan", "read-only", "auto", "full-access"]],
  ] as const)("returns %s execution modes", (adapter, expected) => {
    expect(getAvailableModesForAdapter(adapter).map((mode) => mode.id)).toEqual(
      expected,
    );
  });
});
