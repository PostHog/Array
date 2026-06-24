// Budget evaluator — pure brain for the live budget meter + auto-engage (alpha).
//
// Reads cumulative month-to-date PostHog Code spend (scoped_cost_usd from
// getPersonalSpendAnalysis) against a user-set cap and decides whether to nudge,
// auto-engage save mode, or soft-block. The usage monitor calls this on each
// refresh; the UI renders the meter. Gated by the `llm-gateway-cost-controls`
// alpha flag at the call site.

import type { SaveMode } from "./saveMode";

export type BudgetStatus = "disabled" | "ok" | "warn" | "engage" | "blocked";

export interface BudgetInput {
  monthlyBudgetUsd: number; // 0 or negative => no cap set => disabled
  scopedSpendUsd: number; // month-to-date PostHog Code spend
  warnAtFraction?: number; // default 0.70
  engageAtFraction?: number; // default 0.85
}

export interface BudgetResult {
  status: BudgetStatus;
  fractionUsed: number;
  remainingUsd: number;
  recommendedMode: SaveMode;
  // Soft stop: the UI warns and gates new full-power runs until next period or
  // an explicit override. We never hard-kill an in-flight task.
  block: boolean;
}

export function evaluateBudget(input: BudgetInput): BudgetResult {
  const warnAt = input.warnAtFraction ?? 0.7;
  const engageAt = input.engageAtFraction ?? 0.85;

  if (!(input.monthlyBudgetUsd > 0)) {
    return {
      status: "disabled",
      fractionUsed: 0,
      remainingUsd: Number.POSITIVE_INFINITY,
      recommendedMode: "off",
      block: false,
    };
  }

  const fractionUsed = input.scopedSpendUsd / input.monthlyBudgetUsd;
  const remainingUsd = Math.max(
    0,
    input.monthlyBudgetUsd - input.scopedSpendUsd,
  );

  if (fractionUsed >= 1) {
    return {
      status: "blocked",
      fractionUsed,
      remainingUsd,
      recommendedMode: "max_save",
      block: true,
    };
  }
  if (fractionUsed >= engageAt) {
    return {
      status: "engage",
      fractionUsed,
      remainingUsd,
      recommendedMode: "max_save",
      block: false,
    };
  }
  if (fractionUsed >= warnAt) {
    return {
      status: "warn",
      fractionUsed,
      remainingUsd,
      recommendedMode: "balanced",
      block: false,
    };
  }
  return {
    status: "ok",
    fractionUsed,
    remainingUsd,
    recommendedMode: "off",
    block: false,
  };
}
