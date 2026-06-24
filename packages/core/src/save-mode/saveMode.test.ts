import { describe, expect, it } from "vitest";
import { resolveSaveMode } from "./saveMode";

describe("resolveSaveMode", () => {
  it("passes model/effort through when off and records the baseline", () => {
    const r = resolveSaveMode({
      mode: "off",
      requestedModel: "claude-opus-4-8",
      requestedEffort: "xhigh",
    });
    expect(r.model).toBe("claude-opus-4-8");
    expect(r.effort).toBe("xhigh");
    expect(r.systemReminder).toBeNull();
    expect(r.telemetry.saveMode).toBe(false);
    expect(r.telemetry.baselineModel).toBe("claude-opus-4-8");
  });

  it("balanced caps effort at high, keeps the model, adds a reminder", () => {
    const r = resolveSaveMode({
      mode: "balanced",
      requestedModel: "claude-opus-4-8",
      requestedEffort: "max",
    });
    expect(r.model).toBe("claude-opus-4-8");
    expect(r.effort).toBe("high");
    expect(r.systemReminder).not.toBeNull();
    expect(r.telemetry.saveMode).toBe(true);
    expect(r.telemetry.baselineEffort).toBe("max");
  });

  it("max_save downshifts opus->sonnet and caps effort at medium", () => {
    const r = resolveSaveMode({
      mode: "max_save",
      requestedModel: "claude-opus-4-8",
      requestedEffort: "xhigh",
    });
    expect(r.model).toBe("claude-sonnet-4-6");
    expect(r.effort).toBe("medium");
    expect(r.telemetry.baselineModel).toBe("claude-opus-4-8");
  });

  it("never raises an already-low effort", () => {
    const r = resolveSaveMode({
      mode: "max_save",
      requestedModel: "claude-sonnet-4-6",
      requestedEffort: "low",
    });
    expect(r.effort).toBe("low");
    expect(r.model).toBe("claude-sonnet-4-6");
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
