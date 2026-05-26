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
      resets_in_seconds: 3600,
      exceeded: overrides.sustained ?? false,
    },
    burst: {
      used_percent: 30,
      resets_in_seconds: 600,
      exceeded: overrides.burst ?? false,
    },
    is_rate_limited: overrides.isRateLimited ?? false,
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

  it("returns minutes-only under 1h", () => {
    expect(formatResetTime(undefined, 30 * 60, NOW)).toBe("Resets in 30m");
  });

  it("returns hours + minutes under 24h", () => {
    expect(formatResetTime(undefined, 4 * 3600 + 30 * 60, NOW)).toBe(
      "Resets in 4h 30m",
    );
  });

  it("returns hours only when minutes round to 0", () => {
    expect(formatResetTime(undefined, 4 * 3600, NOW)).toBe("Resets in 4h");
  });

  it("returns localized date when over 24h away", () => {
    const result = formatResetTime(undefined, 30 * 86400, NOW);
    expect(result).toMatch(/^Resets [A-Za-z]+ \d+ at /);
  });

  it("prefers reset_at over the fallback seconds", () => {
    const iso = new Date(NOW + 4 * 3600 * 1000).toISOString();
    expect(formatResetTime(iso, 99999, NOW)).toBe("Resets in 4h");
  });

  it("treats an already-past reset_at as shortly", () => {
    const iso = new Date(NOW - 60_000).toISOString();
    expect(formatResetTime(iso, 0, NOW)).toBe("Resets shortly");
  });
});
