import { deriveSeatView } from "@posthog/core/billing/seatView";
import { useSeatStore } from "./seatStore";

export function useSeat() {
  const seat = useSeatStore((s) => s.seat);
  const orgSeat = useSeatStore((s) => s.orgSeat);
  const isLoading = useSeatStore((s) => s.isLoading);
  const error = useSeatStore((s) => s.error);
  const redirectUrl = useSeatStore((s) => s.redirectUrl);
  const billingOrgId = useSeatStore((s) => s.billingOrgId);

  const view = deriveSeatView(seat, orgSeat);

  return {
    seat,
    orgSeat,
    isLoading,
    error,
    redirectUrl,
    billingOrgId,
    ...view,
  };
}
