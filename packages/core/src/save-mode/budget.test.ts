import { describe, expect, it } from "vitest";
import { evaluateBudget } from "./budget";

describe("evaluateBudget", () => {
  it.each([
    {
      label: "disabled — no cap set (0)",
      input: { monthlyBudgetUsd: 0, scopedSpendUsd: 5 },
      expected: { status: "disabled", recommendedMode: "off", block: false },
    },
    {
      label: "ok — under 70% threshold",
      input: { monthlyBudgetUsd: 20, scopedSpendUsd: 5 },
      expected: { status: "ok", block: false },
    },
    {
      label: "warn — at 75% (>=70%)",
      input: { monthlyBudgetUsd: 20, scopedSpendUsd: 15 },
      expected: { status: "warn", recommendedMode: "balanced", block: false },
    },
    {
      label: "engage — at 87.5% (>=85%)",
      input: { monthlyBudgetUsd: 20, scopedSpendUsd: 17.5 },
      expected: { status: "engage", recommendedMode: "max_save", block: false },
    },
    {
      label: "blocked — at 110% (>=100%)",
      input: { monthlyBudgetUsd: 20, scopedSpendUsd: 22 },
      expected: { status: "blocked", block: true },
    },
  ])("$label", ({ input, expected }) => {
    const r = evaluateBudget(input);
    expect(r.status).toBe(expected.status);
    if ("block" in expected) expect(r.block).toBe(expected.block);
    if ("recommendedMode" in expected)
      expect(r.recommendedMode).toBe(expected.recommendedMode);
  });
});
