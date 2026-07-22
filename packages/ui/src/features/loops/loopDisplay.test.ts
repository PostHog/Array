import { describe, expect, it } from "vitest";
import { describeTrigger } from "./loopDisplay";

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
