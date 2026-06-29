import { describe, expect, it } from "vitest";
import {
  buildConfigOptions,
  CODEX_MODES,
  DEFAULT_EFFORTS,
  modeApprovalPolicy,
} from "./session-config";

describe("modeApprovalPolicy", () => {
  it.each([
    ["read-only", "untrusted"],
    ["auto", "on-request"],
    ["full-access", "never"],
  ])("maps mode %s to approval policy %s", (mode, policy) => {
    expect(modeApprovalPolicy(mode)).toBe(policy);
  });

  it("returns undefined for an unknown mode", () => {
    expect(modeApprovalPolicy("nonsense")).toBeUndefined();
    expect(modeApprovalPolicy(undefined)).toBeUndefined();
  });

  it("every CODEX_MODES entry has a resolvable policy", () => {
    for (const mode of CODEX_MODES) {
      expect(modeApprovalPolicy(mode.id)).toBe(mode.approvalPolicy);
    }
  });
});

describe("buildConfigOptions", () => {
  it("emits a model + thought_level selector from the live lists", () => {
    const opts = buildConfigOptions({
      model: "gpt-5.5",
      effort: "high",
      models: [
        { id: "gpt-5.5", name: "GPT-5.5" },
        { id: "gpt-5-mini", name: "GPT-5 mini" },
      ],
      efforts: ["low", "high"],
    });
    expect(opts.map((o) => (o as { category: string }).category)).toEqual([
      "model",
      "thought_level",
    ]);
    expect((opts[0] as { currentValue: string }).currentValue).toBe("gpt-5.5");
    expect(
      (opts[0] as { options: Array<{ value: string }> }).options.map(
        (o) => o.value,
      ),
    ).toEqual(["gpt-5.5", "gpt-5-mini"]);
  });

  it("keeps the active model/effort selectable even if the lists omit them", () => {
    const opts = buildConfigOptions({
      model: "gpt-5.5",
      effort: "max",
      models: [{ id: "gpt-5-mini", name: "GPT-5 mini" }],
      efforts: ["low", "high"],
    });
    const model = opts[0] as {
      currentValue: string;
      options: Array<{ value: string }>;
    };
    const effort = opts[1] as {
      currentValue: string;
      options: Array<{ value: string }>;
    };
    expect(model.currentValue).toBe("gpt-5.5");
    expect(model.options.map((o) => o.value)).toContain("gpt-5.5");
    expect(effort.currentValue).toBe("max");
    expect(effort.options.map((o) => o.value)).toContain("max");
  });

  it("falls back to the single current model and DEFAULT_EFFORTS when lists are empty", () => {
    const opts = buildConfigOptions({
      model: "gpt-5.5",
      models: [],
      efforts: [],
    });
    expect((opts[0] as { options: Array<{ value: string }> }).options).toEqual([
      { name: "gpt-5.5", value: "gpt-5.5" },
    ]);
    expect(
      (opts[1] as { options: Array<{ value: string }> }).options.map(
        (o) => o.value,
      ),
    ).toEqual(DEFAULT_EFFORTS);
  });
});
