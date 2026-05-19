import { useSeatStore } from "@features/billing/stores/seatStore";
import { isProPlan, seatHasAccess } from "@shared/types/seat";

export function useSeat() {
  const seat = useSeatStore((s) => s.seat);
  const orgSeat = useSeatStore((s) => s.orgSeat);
  const isLoading = useSeatStore((s) => s.isLoading);
  const error = useSeatStore((s) => s.error);
  const redirectUrl = useSeatStore((s) => s.redirectUrl);
  const billingOrgId = useSeatStore((s) => s.billingOrgId);

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
    seat,
    orgSeat,
    isLoading,
    error,
    redirectUrl,
    billingOrgId,
    isPro,
    isOrgPro,
    hasAccess,
    isCanceling,
    planLabel,
    activeUntil,
    hasBetterPlanElsewhere,
  };
}
