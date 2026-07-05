import type { SeatOperationResult } from "@posthog/core/billing/seatService";
import { PLAN_PRO, type SeatData } from "@posthog/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSeatStore } from "./seatStore";

const serviceRef = vi.hoisted(
  () => ({ current: null }) as { current: unknown },
);

vi.mock("@posthog/di/container", () => ({
  resolveService: () => serviceRef.current,
}));

function makeSeat(overrides: Partial<SeatData> = {}): SeatData {
  return {
    id: 1,
    user_distinct_id: "user-123",
    product_key: "posthog_code",
    plan_key: PLAN_PRO,
    status: "active",
    end_reason: null,
    created_at: 1_700_000_000_000,
    active_until: null,
    active_from: 1_700_000_000_000,
    organization_id: "org-1",
    ...overrides,
  };
}

function mockService(result: SeatOperationResult) {
  const service = {
    fetchSeat: vi.fn().mockResolvedValue(result),
    provisionFreeSeat: vi.fn().mockResolvedValue(result),
    upgradeToPro: vi.fn().mockResolvedValue(result),
    cancelSeat: vi.fn().mockResolvedValue(result),
    reactivateSeat: vi.fn().mockResolvedValue(result),
  };
  serviceRef.current = service;
  return service;
}

function okResult(seat: SeatData): SeatOperationResult {
  return {
    seat,
    orgSeat: seat,
    billingOrgId: seat.organization_id ?? null,
    error: null,
    redirectUrl: null,
  };
}

describe("seatStore (thin)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSeatStore.getState().reset();
  });

  it("fetchSeat delegates to the service and applies the result", async () => {
    const seat = makeSeat();
    const service = mockService(okResult(seat));

    await useSeatStore.getState().fetchSeat({ autoProvision: true });

    expect(service.fetchSeat).toHaveBeenCalledWith({
      autoProvision: true,
      currentSeat: null,
    });
    const state = useSeatStore.getState();
    expect(state.seat).toEqual(seat);
    expect(state.billingOrgId).toBe("org-1");
    expect(state.isLoading).toBe(false);
  });

  it("applies a classified error from the service", async () => {
    mockService({
      seat: null,
      orgSeat: null,
      billingOrgId: null,
      error: "Billing subscription required",
      redirectUrl: "/organization/billing",
    });

    await useSeatStore.getState().fetchSeat();

    const state = useSeatStore.getState();
    expect(state.error).toBe("Billing subscription required");
    expect(state.redirectUrl).toBe("/organization/billing");
  });

  it("keeps existing seat when service signals keepExisting", async () => {
    const seat = makeSeat();
    useSeatStore.setState({ seat });
    mockService({
      seat,
      orgSeat: null,
      billingOrgId: "org-1",
      error: null,
      redirectUrl: null,
      keepExisting: true,
    });

    await useSeatStore.getState().fetchSeat();

    expect(useSeatStore.getState().seat).toEqual(seat);
    expect(useSeatStore.getState().isLoading).toBe(false);
  });

  it("cancelSeat passes the current plan_key to the service", async () => {
    const seat = makeSeat({ plan_key: PLAN_PRO });
    useSeatStore.setState({ seat });
    const service = mockService(okResult(seat));

    await useSeatStore.getState().cancelSeat();

    expect(service.cancelSeat).toHaveBeenCalledWith(PLAN_PRO);
  });

  it("reset clears all state", () => {
    useSeatStore.setState({
      seat: makeSeat(),
      isLoading: true,
      error: "some error",
      redirectUrl: "https://example.com",
    });

    useSeatStore.getState().reset();

    const state = useSeatStore.getState();
    expect(state.seat).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.redirectUrl).toBeNull();
  });
});
