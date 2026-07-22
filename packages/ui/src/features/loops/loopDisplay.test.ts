import { describe, expect, it } from "vitest";
import {
  describeTrigger,
  summarizeNotificationDestinations,
} from "./loopDisplay";

describe("describeTrigger", () => {
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
    ).toBe(`Schedule · ${expected}`);
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
