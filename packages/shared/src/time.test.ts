import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatRelativeTimeLong,
  formatRelativeTimeShort,
  getRelativeDateGroup,
} from "./time";

const NOW = new Date("2026-06-15T12:00:00.000Z").getTime();
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("formatRelativeTimeShort", () => {
  it("returns 'now' for sub-minute differences", () => {
    expect(formatRelativeTimeShort(NOW - 30_000)).toBe("now");
  });

  it.each([
    [5 * MINUTE, "5m"],
    [2 * HOUR, "2h"],
    [3 * DAY, "3d"],
    [8 * DAY, "1w"],
    [35 * DAY, "1mo"],
    [400 * DAY, "1y"],
  ])("formats a difference of %dms as %s", (ago, expected) => {
    expect(formatRelativeTimeShort(NOW - ago)).toBe(expected);
  });

  it("accepts an ISO string timestamp", () => {
    expect(
      formatRelativeTimeShort(new Date(NOW - 5 * MINUTE).toISOString()),
    ).toBe("5m");
  });
});

describe("formatRelativeTimeLong", () => {
  it("returns 'just now' under a minute", () => {
    expect(formatRelativeTimeLong(NOW - 30_000)).toBe("just now");
  });

  it("uses singular and plural minute phrasing", () => {
    expect(formatRelativeTimeLong(NOW - MINUTE)).toBe("1 minute ago");
    expect(formatRelativeTimeLong(NOW - 5 * MINUTE)).toBe("5 minutes ago");
  });

  it("uses singular and plural hour phrasing", () => {
    expect(formatRelativeTimeLong(NOW - HOUR)).toBe("1 hour ago");
    expect(formatRelativeTimeLong(NOW - 3 * HOUR)).toBe("3 hours ago");
  });

  it("uses singular and plural day phrasing within a week", () => {
    expect(formatRelativeTimeLong(NOW - DAY)).toBe("1 day ago");
    expect(formatRelativeTimeLong(NOW - 3 * DAY)).toBe("3 days ago");
  });

  it("falls back to a locale date older than a week", () => {
    expect(formatRelativeTimeLong(NOW - 400 * DAY)).toContain("2025");
  });
});

describe("getRelativeDateGroup", () => {
  it("returns null for today", () => {
    expect(getRelativeDateGroup(NOW - 2 * HOUR)).toBeNull();
  });

  it("groups one calendar day back as Yesterday", () => {
    expect(getRelativeDateGroup(NOW - DAY)).toBe("Yesterday");
  });

  it("groups a few days back as This week", () => {
    expect(getRelativeDateGroup(NOW - 3 * DAY)).toBe("This week");
  });

  it("groups within the month as This month", () => {
    expect(getRelativeDateGroup(NOW - 10 * DAY)).toBe("This month");
  });

  it("groups older dates as Earlier", () => {
    expect(getRelativeDateGroup(NOW - 40 * DAY)).toBe("Earlier");
  });
});
