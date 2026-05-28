import type { UsageOutput } from "@main/services/llm-gateway/schemas";
import { describe, expect, it } from "vitest";
import { formatResetTime, isUsageExceeded } from "./utils";

function makeUsage(
  overrides: Partial<{
    sustained: boolean;
    burst: boolean;
    isRateLimited: boolean;
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
    is_pro: false,
  };
}

describe("isUsageExceeded", () => {
  it("returns false when nothing is exceeded", () => {
    expect(isUsageExceeded(makeUsage())).toBe(false);
  });

  it("returns true when sustained is exceeded", () => {
    expect(isUsageExceeded(makeUsage({ sustained: true }))).toBe(true);
  });

  it("returns true when burst is exceeded", () => {
    expect(isUsageExceeded(makeUsage({ burst: true }))).toBe(true);
  });

  it("returns true when rate limited", () => {
    expect(isUsageExceeded(makeUsage({ isRateLimited: true }))).toBe(true);
  });

  it("returns true when all flags are set", () => {
    expect(
      isUsageExceeded(
        makeUsage({ sustained: true, burst: true, isRateLimited: true }),
      ),
    ).toBe(true);
  });
});

describe("formatResetTime", () => {
  const NOW = Date.parse("2026-05-01T12:00:00.000Z");
  const isoAt = (msFromNow: number) => new Date(NOW + msFromNow).toISOString();

  it.each([
    {
      name: "returns minutes-only under 1h",
      resetAt: isoAt(30 * 60 * 1000),
      expected: "Resets in 30m" as string | RegExp,
    },
    {
      name: "returns hours + minutes under 24h",
      resetAt: isoAt((4 * 3600 + 30 * 60) * 1000),
      expected: "Resets in 4h 30m",
    },
    {
      name: "returns hours only when minutes round to 0",
      resetAt: isoAt(4 * 3600 * 1000),
      expected: "Resets in 4h",
    },
    {
      name: "returns localized date when over 24h away",
      resetAt: isoAt(30 * 86400 * 1000),
      expected: /^Resets [A-Za-z]+ \d+ at /,
    },
    {
      name: "treats an already-past reset_at as shortly",
      resetAt: isoAt(-60_000),
      expected: "Resets shortly",
    },
    {
      name: "treats an unparseable reset_at as shortly",
      resetAt: "not-a-date",
      expected: "Resets shortly",
    },
  ])("$name", ({ resetAt, expected }) => {
    const result = formatResetTime(resetAt, NOW);
    if (expected instanceof RegExp) {
      expect(result).toMatch(expected);
    } else {
      expect(result).toBe(expected);
    }
  });
});
