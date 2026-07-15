import type { RootLogger } from "@posthog/di/logger";
import {
  PLAN_FREE,
  PLAN_PRO,
  PLAN_PRO_ALPHA,
  type SeatData,
} from "@posthog/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SeatClient } from "./identifiers";
import { SeatService } from "./seatService";

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

function makeClient(overrides: Partial<SeatClient> = {}): SeatClient {
  return {
    getMySeat: vi.fn().mockResolvedValue(null),
    createSeat: vi.fn().mockResolvedValue(makeSeat()),
    upgradeSeat: vi.fn().mockResolvedValue(makeSeat({ plan_key: PLAN_PRO })),
    cancelSeat: vi.fn().mockResolvedValue(undefined),
    reactivateSeat: vi.fn().mockResolvedValue(makeSeat()),
    invalidatePlanCache: vi.fn(),
    trackSubscriptionStarted: vi.fn(),
    trackSubscriptionCancelled: vi.fn(),
    ...overrides,
  };
}

const logger: RootLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  scope: () => logger,
};

class SeatSubscriptionRequiredError extends Error {
  redirectUrl: string;
  constructor(redirectUrl: string) {
    super("subscription required");
    this.name = "SeatSubscriptionRequiredError";
    this.redirectUrl = redirectUrl;
  }
}

class SeatPaymentFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeatPaymentFailedError";
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchSeat", () => {
  it("fetches existing seat", async () => {
    const seat = makeSeat();
    const client = makeClient({ getMySeat: vi.fn().mockResolvedValue(seat) });
    const result = await new SeatService(client, logger).fetchSeat();
    expect(result.seat).toEqual(seat);
    expect(result.error).toBeNull();
  });

  it("auto-provisions free seat when none exists", async () => {
    const seat = makeSeat();
    const client = makeClient({
      getMySeat: vi.fn().mockResolvedValue(null),
      createSeat: vi.fn().mockResolvedValue(seat),
    });
    const result = await new SeatService(client, logger).fetchSeat({
      autoProvision: true,
    });
    expect(client.createSeat).toHaveBeenCalledWith(PLAN_FREE);
    expect(result.seat).toEqual(seat);
  });

  it("does not auto-provision when option is false", async () => {
    const client = makeClient();
    const result = await new SeatService(client, logger).fetchSeat();
    expect(client.createSeat).not.toHaveBeenCalled();
    expect(result.seat).toBeNull();
  });

  it("keeps existing seat when fetch fails", async () => {
    const existing = makeSeat();
    const client = makeClient({
      getMySeat: vi.fn().mockRejectedValue(new Error("Network error")),
    });
    const result = await new SeatService(client, logger).fetchSeat({
      currentSeat: existing,
    });
    expect(result.keepExisting).toBe(true);
    expect(result.seat).toEqual(existing);
    expect(result.error).toBeNull();
  });
});

describe("provisionFreeSeat", () => {
  it("creates free seat when none exists", async () => {
    const seat = makeSeat();
    const client = makeClient({ createSeat: vi.fn().mockResolvedValue(seat) });
    const result = await new SeatService(client, logger).provisionFreeSeat();
    expect(client.createSeat).toHaveBeenCalledWith(PLAN_FREE);
    expect(result.seat).toEqual(seat);
    expect(result.orgSeatUnchanged).toBe(true);
    expect(client.invalidatePlanCache).toHaveBeenCalled();
  });

  it("uses existing seat instead of creating", async () => {
    const existing = makeSeat();
    const client = makeClient({
      getMySeat: vi.fn().mockResolvedValue(existing),
    });
    const result = await new SeatService(client, logger).provisionFreeSeat();
    expect(client.createSeat).not.toHaveBeenCalled();
    expect(result.seat).toEqual(existing);
    expect(client.invalidatePlanCache).not.toHaveBeenCalled();
  });
});

describe("upgradeToPro", () => {
  it("upgrades existing free seat to pro", async () => {
    const freeSeat = makeSeat({ plan_key: PLAN_FREE });
    const proSeat = makeSeat({ plan_key: PLAN_PRO });
    const client = makeClient({
      getMySeat: vi.fn().mockResolvedValue(freeSeat),
      upgradeSeat: vi.fn().mockResolvedValue(proSeat),
    });
    const result = await new SeatService(client, logger).upgradeToPro();
    expect(client.upgradeSeat).toHaveBeenCalledWith(PLAN_PRO);
    expect(result.seat).toEqual(proSeat);
    expect(client.invalidatePlanCache).toHaveBeenCalled();
    expect(client.trackSubscriptionStarted).toHaveBeenCalledWith({
      plan_key: PLAN_PRO,
      previous_plan_key: PLAN_FREE,
    });
  });

  it("no-ops when already on pro", async () => {
    const proSeat = makeSeat({ plan_key: PLAN_PRO });
    const client = makeClient({
      getMySeat: vi.fn().mockResolvedValue(proSeat),
    });
    const result = await new SeatService(client, logger).upgradeToPro();
    expect(client.upgradeSeat).not.toHaveBeenCalled();
    expect(client.createSeat).not.toHaveBeenCalled();
    expect(result.seat).toEqual(proSeat);
    expect(client.trackSubscriptionStarted).not.toHaveBeenCalled();
  });

  it("upgrades alpha pro seat to paid pro", async () => {
    const alphaSeat = makeSeat({ plan_key: PLAN_PRO_ALPHA });
    const proSeat = makeSeat({ plan_key: PLAN_PRO });
    const client = makeClient({
      getMySeat: vi.fn().mockResolvedValue(alphaSeat),
      upgradeSeat: vi.fn().mockResolvedValue(proSeat),
    });
    const result = await new SeatService(client, logger).upgradeToPro();
    expect(client.upgradeSeat).toHaveBeenCalledWith(PLAN_PRO);
    expect(result.seat).toEqual(proSeat);
    expect(client.trackSubscriptionStarted).toHaveBeenCalledWith({
      plan_key: PLAN_PRO,
      previous_plan_key: PLAN_PRO_ALPHA,
    });
  });

  it("creates pro seat when none exists", async () => {
    const proSeat = makeSeat({ plan_key: PLAN_PRO });
    const client = makeClient({
      createSeat: vi.fn().mockResolvedValue(proSeat),
    });
    await new SeatService(client, logger).upgradeToPro();
    expect(client.createSeat).toHaveBeenCalledWith(PLAN_PRO);
    expect(client.invalidatePlanCache).toHaveBeenCalled();
    expect(client.trackSubscriptionStarted).toHaveBeenCalledWith({
      plan_key: PLAN_PRO,
    });
  });

  it("does not invalidate plan cache on failure", async () => {
    const client = makeClient({
      getMySeat: vi.fn().mockRejectedValue(new Error("Network error")),
    });
    await new SeatService(client, logger).upgradeToPro();
    expect(client.invalidatePlanCache).not.toHaveBeenCalled();
  });
});

describe("cancelSeat", () => {
  it("cancels and re-fetches seat", async () => {
    const cancelingSeat = makeSeat({
      plan_key: PLAN_PRO,
      status: "canceling",
    });
    const client = makeClient({
      getMySeat: vi.fn().mockResolvedValue(cancelingSeat),
    });
    const result = await new SeatService(client, logger).cancelSeat(PLAN_PRO);
    expect(client.cancelSeat).toHaveBeenCalled();
    expect(result.seat).toEqual(cancelingSeat);
    expect(client.invalidatePlanCache).toHaveBeenCalled();
    expect(client.trackSubscriptionCancelled).toHaveBeenCalledWith({
      plan_key: PLAN_PRO,
    });
  });

  it("falls back to API response plan_key when previous is undefined", async () => {
    const cancelingSeat = makeSeat({
      plan_key: PLAN_PRO,
      status: "canceling",
    });
    const client = makeClient({
      getMySeat: vi.fn().mockResolvedValue(cancelingSeat),
    });
    await new SeatService(client, logger).cancelSeat();
    expect(client.trackSubscriptionCancelled).toHaveBeenCalledWith({
      plan_key: PLAN_PRO,
    });
  });

  it("skips tracking when no plan_key is available", async () => {
    const client = makeClient({
      getMySeat: vi.fn().mockResolvedValue(null),
    });
    await new SeatService(client, logger).cancelSeat();
    expect(client.cancelSeat).toHaveBeenCalled();
    expect(client.trackSubscriptionCancelled).not.toHaveBeenCalled();
  });
});

describe("reactivateSeat", () => {
  it("reactivates seat", async () => {
    const seat = makeSeat({ status: "active" });
    const client = makeClient({
      reactivateSeat: vi.fn().mockResolvedValue(seat),
    });
    const result = await new SeatService(client, logger).reactivateSeat();
    expect(result.seat).toEqual(seat);
    expect(client.invalidatePlanCache).toHaveBeenCalled();
  });
});

describe("error classification", () => {
  it("sets redirect URL on subscription required error", async () => {
    const client = makeClient({
      getMySeat: vi
        .fn()
        .mockRejectedValue(
          new SeatSubscriptionRequiredError("/organization/billing"),
        ),
    });
    const result = await new SeatService(client, logger).fetchSeat();
    expect(result.error).toBe("Billing subscription required");
    expect(result.redirectUrl).toBe("/organization/billing");
  });

  it("sets error on payment failure", async () => {
    const client = makeClient({
      getMySeat: vi
        .fn()
        .mockRejectedValue(new SeatPaymentFailedError("Card declined")),
    });
    const result = await new SeatService(client, logger).fetchSeat();
    expect(result.error).toBe("Card declined");
  });
});
