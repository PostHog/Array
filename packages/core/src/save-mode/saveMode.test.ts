import { describe, expect, it } from "vitest";
import { resolveSaveMode } from "./saveMode";

describe("resolveSaveMode", () => {
  it.each([
    {
      label: "off — passes model/effort through",
      input: {
        mode: "off" as const,
        requestedModel: "claude-opus-4-8",
        requestedEffort: "xhigh" as const,
      },
      expected: {
        model: "claude-opus-4-8",
        effort: "xhigh",
        systemReminder: null,
        saveMode: false,
      },
    },
    {
      label: "balanced — caps effort at high, keeps model, adds reminder",
      input: {
        mode: "balanced" as const,
        requestedModel: "claude-opus-4-8",
        requestedEffort: "max" as const,
      },
      expected: {
        model: "claude-opus-4-8",
        effort: "high",
        systemReminder: "non-null",
        saveMode: true,
        baselineEffort: "max",
      },
    },
    {
      label: "max_save — downshifts opus→sonnet, caps effort at medium",
      input: {
        mode: "max_save" as const,
        requestedModel: "claude-opus-4-8",
        requestedEffort: "xhigh" as const,
      },
      expected: {
        model: "claude-sonnet-4-6",
        effort: "medium",
        saveMode: true,
        baselineModel: "claude-opus-4-8",
      },
    },
    {
      label: "max_save — never raises an already-low effort",
      input: {
        mode: "max_save" as const,
        requestedModel: "claude-sonnet-4-6",
        requestedEffort: "low" as const,
      },
      expected: { model: "claude-sonnet-4-6", effort: "low" },
    },
    {
      label: "balanced — never raises low effort",
      input: {
        mode: "balanced" as const,
        requestedModel: "claude-opus-4-8",
        requestedEffort: "low" as const,
      },
      expected: { model: "claude-opus-4-8", effort: "low" },
    },
  ])("$label", ({ input, expected }) => {
    const r = resolveSaveMode(input);
    expect(r.model).toBe(expected.model);
    expect(r.effort).toBe(expected.effort);
    if ("systemReminder" in expected) {
      if (expected.systemReminder === null) {
        expect(r.systemReminder).toBeNull();
      } else {
        expect(r.systemReminder).not.toBeNull();
      }
    }
    if ("saveMode" in expected)
      expect(r.telemetry.saveMode).toBe(expected.saveMode);
    if ("baselineModel" in expected)
      expect(r.telemetry.baselineModel).toBe(expected.baselineModel);
    if ("baselineEffort" in expected)
      expect(r.telemetry.baselineEffort).toBe(expected.baselineEffort);
  });

  it("perTaskFullPower bypasses save mode entirely", () => {
    const r = resolveSaveMode({
      mode: "max_save",
      requestedModel: "claude-opus-4-8",
      requestedEffort: "high",
      perTaskFullPower: true,
    });
    expect(r.model).toBe("claude-opus-4-8");
    expect(r.effort).toBe("high");
    expect(r.telemetry.saveMode).toBe(false);
  });
});
