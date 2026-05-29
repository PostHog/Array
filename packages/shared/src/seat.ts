export type SeatStatus =
  | "active"
  | "canceling"
  | "pending"
  | "pending_payment"
  | "expired"
  | "withdrawn";

export interface SeatData {
  id: number;
  user_distinct_id: string;
  product_key: string;
  plan_key: string;
  status: SeatStatus;
  end_reason: string | null;
  created_at: number;
  active_until: number | null;
  active_from: number;
  organization_id?: string;
  organization_name?: string;
}

export const SEAT_PRODUCT_KEY = "posthog_code";
export const PLAN_FREE = "posthog-code-free-20260301";
export const PLAN_PRO = "posthog-code-pro-200-20260301";
export const PLAN_PRO_ALPHA = "posthog-code-pro-0-20260422";

const PRO_PLANS = new Set([PLAN_PRO, PLAN_PRO_ALPHA]);

export function isProPlan(planKey: string | undefined | null): boolean {
  return planKey != null && PRO_PLANS.has(planKey);
}

export function seatHasAccess(status: SeatStatus): boolean {
  return status === "active" || status === "canceling";
}
