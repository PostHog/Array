import type { SeatData } from "@shared/types/seat";
import { PLAN_FREE, PLAN_PRO, PLAN_PRO_ALPHA } from "@shared/types/seat";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAuthenticatedClient = vi.hoisted(() => vi.fn());

vi.mock("@features/auth/hooks/authClient", () => ({
  getAuthenticatedClient: mockGetAuthenticatedClient,
}));

vi.mock("@renderer/api/posthogClient", () => ({
  SeatSubscriptionRequiredError: class SeatSubscriptionRequiredError extends Error {
    redirectUrl: string;
    constructor(redirectUrl: string) {
      super("Billing subscription required");
      this.name = "SeatSubscriptionRequiredError";
      this.redirectUrl = redirectUrl;
    }
  },
  SeatPaymentFailedError: class SeatPaymentFailedError extends Error {
    constructor(message?: string) {
      super(message ?? "Payment failed");
      this.name = "SeatPaymentFailedError";
    }
  },
}));

vi.mock("@utils/logger", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("@renderer/trpc", () => ({
  trpcClient: {
    llmGateway: {
      invalidatePlanCache: { mutate: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock("@utils/analytics", () => ({ track: vi.fn() }));

import { trpcClient } from "@renderer/trpc";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { track } from "@utils/analytics";
import { useSeatStore } from "./seatStore";

const mockInvalidatePlanCache = vi.mocked(
  trpcClient.llmGateway.invalidatePlanCache.mutate,
);
const mockTrack = vi.mocked(track);

function makeSeat(overrides: Partial<SeatData> = {}): SeatData {
  return {
    id: 1,
    user_distinct_id: "user-123",
    product_key: "posthog_code",
    plan_key: PLAN_FREE,
    status: "active",
    end_reason: null,
    created_at: Date.now(),
    active_until: null,
    active_from: Date.now(),
    ...overrides,
  };
}

function mockClient(overrides: Record<string, unknown> = {}) {
  const client = {
    getMySeat: vi.fn().mockResolvedValue(null),
    createSeat: vi.fn().mockResolvedValue(makeSeat()),
    upgradeSeat: vi.fn().mockResolvedValue(makeSeat({ plan_key: PLAN_PRO })),
    cancelSeat: vi.fn().mockResolvedValue(undefined),
    reactivateSeat: vi.fn().mockResolvedValue(makeSeat()),
    ...overrides,
  };
  mockGetAuthenticatedClient.mockResolvedValue(client);
  return client;
}

describe("seatStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSeatStore.setState({
      seat: null,
      orgSeat: null,
      isLoading: false,
      error: null,
      redirectUrl: null,
      billingOrgId: null,
    });
  });

  describe("fetchSeat", () => {
    it("fetches existing seat", async () => {
      const seat = makeSeat();
      mockClient({ getMySeat: vi.fn().mockResolvedValue(seat) });

      await useSeatStore.getState().fetchSeat();

      const state = useSeatStore.getState();
      expect(state.seat).toEqual(seat);
      expect(state.isLoading).toBe(false);
    });

    it("auto-provisions free seat when none exists", async () => {
      const seat = makeSeat();
      const client = mockClient({
        getMySeat: vi.fn().mockResolvedValue(null),
        createSeat: vi.fn().mockResolvedValue(seat),
      });

      await useSeatStore.getState().fetchSeat({ autoProvision: true });

      expect(client.createSeat).toHaveBeenCalledWith(PLAN_FREE);
      expect(useSeatStore.getState().seat).toEqual(seat);
    });

    it("does not auto-provision when option is false", async () => {
      const client = mockClient();

      await useSeatStore.getState().fetchSeat();

      expect(client.createSeat).not.toHaveBeenCalled();
      expect(useSeatStore.getState().seat).toBeNull();
    });
  });

  describe("provisionFreeSeat", () => {
    it("creates free seat when none exists", async () => {
      const seat = makeSeat();
      const client = mockClient({
        createSeat: vi.fn().mockResolvedValue(seat),
      });

      await useSeatStore.getState().provisionFreeSeat();

      expect(client.createSeat).toHaveBeenCalledWith(PLAN_FREE);
      expect(useSeatStore.getState().seat).toEqual(seat);
      expect(mockInvalidatePlanCache).toHaveBeenCalled();
    });

    it("uses existing seat instead of creating", async () => {
      const existing = makeSeat();
      const client = mockClient({
        getMySeat: vi.fn().mockResolvedValue(existing),
      });

      await useSeatStore.getState().provisionFreeSeat();

      expect(client.createSeat).not.toHaveBeenCalled();
      expect(useSeatStore.getState().seat).toEqual(existing);
      expect(mockInvalidatePlanCache).not.toHaveBeenCalled();
    });
  });

  describe("upgradeToPro", () => {
    it("upgrades existing free seat to pro", async () => {
      const freeSeat = makeSeat({ plan_key: PLAN_FREE });
      const proSeat = makeSeat({ plan_key: PLAN_PRO });
      const client = mockClient({
        getMySeat: vi.fn().mockResolvedValue(freeSeat),
        upgradeSeat: vi.fn().mockResolvedValue(proSeat),
      });

      await useSeatStore.getState().upgradeToPro();

      expect(client.upgradeSeat).toHaveBeenCalledWith(PLAN_PRO);
      expect(useSeatStore.getState().seat).toEqual(proSeat);
      expect(mockInvalidatePlanCache).toHaveBeenCalled();
      expect(mockTrack).toHaveBeenCalledWith(
        ANALYTICS_EVENTS.SUBSCRIPTION_STARTED,
        { plan_key: PLAN_PRO, previous_plan_key: PLAN_FREE },
      );
    });

    it("no-ops when already on pro", async () => {
      const proSeat = makeSeat({ plan_key: PLAN_PRO });
      const client = mockClient({
        getMySeat: vi.fn().mockResolvedValue(proSeat),
      });

      await useSeatStore.getState().upgradeToPro();

      expect(client.upgradeSeat).not.toHaveBeenCalled();
      expect(client.createSeat).not.toHaveBeenCalled();
      expect(useSeatStore.getState().seat).toEqual(proSeat);
      expect(mockTrack).not.toHaveBeenCalled();
    });

    it("upgrades alpha pro seat to paid pro", async () => {
      const alphaSeat = makeSeat({ plan_key: PLAN_PRO_ALPHA });
      const proSeat = makeSeat({ plan_key: PLAN_PRO });
      const client = mockClient({
        getMySeat: vi.fn().mockResolvedValue(alphaSeat),
        upgradeSeat: vi.fn().mockResolvedValue(proSeat),
      });

      await useSeatStore.getState().upgradeToPro();

      expect(client.upgradeSeat).toHaveBeenCalledWith(PLAN_PRO);
      expect(useSeatStore.getState().seat).toEqual(proSeat);
      expect(mockTrack).toHaveBeenCalledWith(
        ANALYTICS_EVENTS.SUBSCRIPTION_STARTED,
        { plan_key: PLAN_PRO, previous_plan_key: PLAN_PRO_ALPHA },
      );
    });

    it("creates pro seat when none exists", async () => {
      const proSeat = makeSeat({ plan_key: PLAN_PRO });
      const client = mockClient({
        createSeat: vi.fn().mockResolvedValue(proSeat),
      });

      await useSeatStore.getState().upgradeToPro();

      expect(client.createSeat).toHaveBeenCalledWith(PLAN_PRO);
      expect(mockInvalidatePlanCache).toHaveBeenCalled();
      expect(mockTrack).toHaveBeenCalledWith(
        ANALYTICS_EVENTS.SUBSCRIPTION_STARTED,
        { plan_key: PLAN_PRO },
      );
    });
  });

  describe("cancelSeat", () => {
    it("cancels and re-fetches seat", async () => {
      const proSeat = makeSeat({ plan_key: PLAN_PRO });
      const cancelingSeat = makeSeat({
        plan_key: PLAN_PRO,
        status: "canceling",
      });
      useSeatStore.setState({ seat: proSeat });
      const client = mockClient({
        getMySeat: vi.fn().mockResolvedValue(cancelingSeat),
      });

      await useSeatStore.getState().cancelSeat();

      expect(client.cancelSeat).toHaveBeenCalled();
      expect(useSeatStore.getState().seat).toEqual(cancelingSeat);
      expect(mockInvalidatePlanCache).toHaveBeenCalled();
      expect(mockTrack).toHaveBeenCalledWith(
        ANALYTICS_EVENTS.SUBSCRIPTION_CANCELLED,
        { plan_key: PLAN_PRO },
      );
    });
  });

  describe("reactivateSeat", () => {
    it("reactivates seat", async () => {
      const seat = makeSeat({ status: "active" });
      mockClient({
        reactivateSeat: vi.fn().mockResolvedValue(seat),
      });

      await useSeatStore.getState().reactivateSeat();

      expect(useSeatStore.getState().seat).toEqual(seat);
      expect(mockInvalidatePlanCache).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("sets redirect URL on subscription required error", async () => {
      const { SeatSubscriptionRequiredError } = await import(
        "@renderer/api/posthogClient"
      );
      mockClient({
        getMySeat: vi
          .fn()
          .mockRejectedValue(
            new SeatSubscriptionRequiredError("/organization/billing"),
          ),
      });

      await useSeatStore.getState().fetchSeat();

      const state = useSeatStore.getState();
      expect(state.error).toBe("Billing subscription required");
      expect(state.redirectUrl).toBe("/organization/billing");
    });

    it("sets error on payment failure", async () => {
      const { SeatPaymentFailedError } = await import(
        "@renderer/api/posthogClient"
      );
      mockClient({
        getMySeat: vi
          .fn()
          .mockRejectedValue(new SeatPaymentFailedError("Card declined")),
      });

      await useSeatStore.getState().fetchSeat();

      expect(useSeatStore.getState().error).toBe("Card declined");
    });

    it("does not invalidate plan cache on failure", async () => {
      mockClient({
        getMySeat: vi.fn().mockRejectedValue(new Error("Network error")),
      });

      await useSeatStore.getState().upgradeToPro();

      expect(mockInvalidatePlanCache).not.toHaveBeenCalled();
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
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
});
