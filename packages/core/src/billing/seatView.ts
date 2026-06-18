import { isProPlan, type SeatData, seatHasAccess } from "@posthog/shared";

export interface SeatView {
  isPro: boolean;
  isOrgPro: boolean;
  hasAccess: boolean;
  isCanceling: boolean;
  planLabel: string;
  activeUntil: Date | null;
  hasBetterPlanElsewhere: boolean;
}

export function deriveSeatView(
  seat: SeatData | null,
  orgSeat: SeatData | null,
): SeatView {
  const isPro = isProPlan(seat?.plan_key);
  const isOrgPro = isProPlan(orgSeat?.plan_key);
  const hasAccess = seat ? seatHasAccess(seat.status) : false;
  const isCanceling = orgSeat?.status === "canceling";
  const planLabel = isPro ? "Pro" : "Free";
  const activeUntil = orgSeat?.active_until
    ? new Date(orgSeat.active_until * 1000)
    : null;

  const hasBetterPlanElsewhere =
    seat !== null &&
    orgSeat !== null &&
    isProPlan(seat.plan_key) &&
    !isProPlan(orgSeat.plan_key);

  return {
    isPro,
    isOrgPro,
    hasAccess,
    isCanceling,
    planLabel,
    activeUntil,
    hasBetterPlanElsewhere,
  };
}
