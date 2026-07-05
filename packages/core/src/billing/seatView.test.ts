import { PLAN_FREE, PLAN_PRO, type SeatData } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import { deriveSeatView } from "./seatView";

function makeSeat(overrides: Partial<SeatData> = {}): SeatData {
  return {
    id: 1,
    user_distinct_id: "user-123",
    product_key: "posthog_code",
    plan_key: PLAN_FREE,
    status: "active",
    end_reason: null,
    created_at: 1_700_000_000_000,
    active_until: null,
    active_from: 1_700_000_000_000,
    ...overrides,
  };
}

describe("deriveSeatView", () => {
  it("returns defaults when no seat", () => {
    const view = deriveSeatView(null, null);
    expect(view.isPro).toBe(false);
    expect(view.hasAccess).toBe(false);
    expect(view.planLabel).toBe("Free");
    expect(view.activeUntil).toBeNull();
    expect(view.hasBetterPlanElsewhere).toBe(false);
  });

  it("labels a pro seat with access", () => {
    const seat = makeSeat({ plan_key: PLAN_PRO });
    const view = deriveSeatView(seat, seat);
    expect(view.isPro).toBe(true);
    expect(view.isOrgPro).toBe(true);
    expect(view.hasAccess).toBe(true);
    expect(view.planLabel).toBe("Pro");
  });

  it("flags a pro personal seat against a free org seat", () => {
    const personal = makeSeat({ plan_key: PLAN_PRO });
    const org = makeSeat({ plan_key: PLAN_FREE });
    expect(deriveSeatView(personal, org).hasBetterPlanElsewhere).toBe(true);
  });

  it("detects canceling org seat and active_until", () => {
    const org = makeSeat({
      plan_key: PLAN_PRO,
      status: "canceling",
      active_until: 1_800_000_000,
    });
    const view = deriveSeatView(org, org);
    expect(view.isCanceling).toBe(true);
    expect(view.activeUntil).toEqual(new Date(1_800_000_000 * 1000));
  });
});
