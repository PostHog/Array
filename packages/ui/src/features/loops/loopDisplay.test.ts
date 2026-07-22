import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeTrigger,
  nextScheduleRun,
  summarizeNotificationDestinations,
  summarizeTrigger,
} from "./loopDisplay";

describe("describeTrigger", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([
    ["0 * * * *", "Every hour (UTC)"],
    ["30 9 * * *", "Daily at 9:30 AM (UTC)"],
    ["0 11 * * 1-5", "Weekdays at 11:00 AM (UTC)"],
    ["15 8 * * 3", "Wednesdays at 8:15 AM (UTC)"],
  ])("formats %s as a readable schedule", (cronExpression, expected) => {
    expect(
      describeTrigger({
        type: "schedule",
        config: { cron_expression: cronExpression, timezone: "UTC" },
      }),
    ).toContain(`Schedule · ${expected} · Next run `);
  });

  it("keeps custom cron expressions visible", () => {
    expect(
      describeTrigger({
        type: "schedule",
        config: { cron_expression: "*/15 * * * *", timezone: "UTC" },
      }),
    ).toBe("Schedule · */15 * * * * (UTC)");
  });
});

describe("summarizeNotificationDestinations", () => {
  it("lists enabled destinations and includes the Slack channel", () => {
    expect(
      summarizeNotificationDestinations({
        push: { enabled: true, events: [], params: {} },
        email: { enabled: false, events: [], params: {} },
        slack: {
          enabled: true,
          events: [],
          params: { channel_name: "#loops" },
        },
      }),
    ).toEqual(["Push", "Slack · #loops"]);
  });

  it("omits disabled destinations", () => {
    expect(
      summarizeNotificationDestinations({
        push: { enabled: false, events: [], params: {} },
        email: { enabled: false, events: [], params: {} },
        slack: { enabled: false, events: [], params: {} },
      }),
    ).toEqual([]);
  });
});

describe("nextScheduleRun", () => {
  it("returns null for an invalid timezone", () => {
    expect(
      nextScheduleRun(
        { cron_expression: "0 9 * * *", timezone: "Not/A_Timezone" },
        new Date("2026-07-22T12:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("skips a local time that does not exist during DST transition", () => {
    expect(
      nextScheduleRun(
        {
          cron_expression: "30 2 * * *",
          timezone: "America/Toronto",
        },
        new Date("2026-03-08T06:00:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-03-09T06:30:00.000Z");
  });

  it("finds the next weekday across a weekend", () => {
    expect(
      nextScheduleRun(
        { cron_expression: "0 9 * * 1-5", timezone: "UTC" },
        new Date("2026-07-24T10:00:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-07-27T09:00:00.000Z");
  });
});

describe("summarizeTrigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T20:09:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("shows a readable schedule instead of raw cron", () => {
    expect(
      summarizeTrigger({
        type: "schedule",
        config: {
          cron_expression: "8 16 * * *",
          timezone: "America/Toronto",
        },
      }),
    ).toBe("Daily at 4:08 PM (EDT) · Next run Thu, Jul 23, 4:08 PM");
  });
});
