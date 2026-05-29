import type { UsageOutput } from "@posthog/core/usage/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const getLatest = vi.fn();
const track = vi.fn();

vi.mock("@posthog/di/container", () => ({
  resolveService: () => ({
    usageMonitor: {
      refresh: { mutate: () => refresh() },
      getLatest: { query: () => getLatest() },
    },
  }),
}));

vi.mock("@posthog/ui/shell/analytics", () => ({
  track: (...args: unknown[]) => track(...args),
}));

vi.mock("@posthog/ui/shell/logger", () => ({
  logger: {
    scope: () => ({
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    }),
  },
}));

import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { assertCloudUsageAvailable } from "./preflightCloudUsage";
import { useUsageLimitStore } from "./usageLimitStore";

function makeUsage(
  overrides: Partial<{
    sustained: boolean;
    burst: boolean;
    isRateLimited: boolean;
    isPro: boolean;
  }> = {},
): UsageOutput {
  return {
    product: "posthog_code",
    user_id: 1,
    sustained: {
      used_percent: 50,
      reset_at: "2026-05-01T13:00:00.000Z",
      exceeded: overrides.sustained ?? false,
    },
    burst: {
      used_percent: 30,
      reset_at: "2026-05-01T12:10:00.000Z",
      exceeded: overrides.burst ?? false,
    },
    is_rate_limited: overrides.isRateLimited ?? false,
    is_pro: overrides.isPro ?? false,
  };
}

interface Case {
  name: string;
  arrange: () => void;
  available: boolean;
  modal: {
    isOpen: boolean;
    bucket?: "burst" | "sustained" | null;
    resetAt?: string | null;
    isPro?: boolean | null;
  };
  trackPayload?: { bucket: "burst" | "sustained" | null; is_pro: boolean };
}

const cases: Case[] = [
  {
    name: "allows creation and shows no modal when under limit",
    arrange: () => refresh.mockResolvedValue(makeUsage()),
    available: true,
    modal: { isOpen: false },
  },
  {
    name: "blocks and shows the burst modal when the daily limit is exceeded",
    arrange: () =>
      refresh.mockResolvedValue(
        makeUsage({ burst: true, isRateLimited: true, isPro: true }),
      ),
    available: false,
    modal: {
      isOpen: true,
      bucket: "burst",
      resetAt: "2026-05-01T12:10:00.000Z",
      isPro: true,
    },
    trackPayload: { bucket: "burst", is_pro: true },
  },
  {
    name: "falls back to the latest snapshot when refresh fails",
    arrange: () => {
      refresh.mockRejectedValue(new Error("network"));
      getLatest.mockResolvedValue(makeUsage({ sustained: true }));
    },
    available: false,
    modal: { isOpen: true, bucket: "sustained" },
    trackPayload: { bucket: "sustained", is_pro: false },
  },
  {
    name: "falls back to the monthly bucket when only is_rate_limited is set",
    arrange: () =>
      refresh.mockResolvedValue(makeUsage({ isRateLimited: true })),
    available: false,
    modal: {
      isOpen: true,
      bucket: "sustained",
      resetAt: "2026-05-01T13:00:00.000Z",
    },
    trackPayload: { bucket: "sustained", is_pro: false },
  },
  {
    name: "fails open (allows creation) when usage cannot be fetched",
    arrange: () => {
      refresh.mockRejectedValue(new Error("network"));
      getLatest.mockRejectedValue(new Error("network"));
    },
    available: true,
    modal: { isOpen: false },
  },
];

describe("assertCloudUsageAvailable", () => {
  beforeEach(() => {
    refresh.mockReset();
    getLatest.mockReset();
    track.mockReset();
    useUsageLimitStore.getState().hide();
  });

  it.each(cases)(
    "$name",
    async ({ arrange, available, modal, trackPayload }) => {
      arrange();

      expect(await assertCloudUsageAvailable()).toBe(available);

      const state = useUsageLimitStore.getState();
      expect(state.isOpen).toBe(modal.isOpen);
      if (modal.bucket !== undefined) expect(state.bucket).toBe(modal.bucket);
      if (modal.resetAt !== undefined)
        expect(state.resetAt).toBe(modal.resetAt);
      if (modal.isPro !== undefined) expect(state.isPro).toBe(modal.isPro);

      if (trackPayload) {
        expect(track).toHaveBeenCalledWith(
          ANALYTICS_EVENTS.CLOUD_TASK_USAGE_BLOCKED,
          trackPayload,
        );
      } else {
        expect(track).not.toHaveBeenCalled();
      }
    },
  );
});
