import { describe, expect, it } from "vitest";
import { evaluateBudget } from "./budget";

describe("evaluateBudget", () => {
  it("is disabled when no cap is set", () => {
    const r = evaluateBudget({ monthlyBudgetUsd: 0, scopedSpendUsd: 5 });
    expect(r.status).toBe("disabled");
    expect(r.recommendedMode).toBe("off");
  });

  it("is ok under the warn threshold", () => {
    const r = evaluateBudget({ monthlyBudgetUsd: 20, scopedSpendUsd: 5 });
    expect(r.status).toBe("ok");
  });

  it("warns and recommends balanced at >=70%", () => {
    const r = evaluateBudget({ monthlyBudgetUsd: 20, scopedSpendUsd: 15 });
    expect(r.status).toBe("warn");
    expect(r.recommendedMode).toBe("balanced");
  });

  it("engages max_save at >=85%", () => {
    const r = evaluateBudget({ monthlyBudgetUsd: 20, scopedSpendUsd: 17.5 });
    expect(r.status).toBe("engage");
    expect(r.recommendedMode).toBe("max_save");
  });

  it("soft-blocks at >=100%", () => {
    const r = evaluateBudget({ monthlyBudgetUsd: 20, scopedSpendUsd: 22 });
    expect(r.status).toBe("blocked");
    expect(r.block).toBe(true);
  });
});
