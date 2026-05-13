import { describe, expect, it } from "vitest";
import { describeCron, parseSchedule } from "./parseSchedule";

describe("parseSchedule", () => {
  it("returns null for empty input", () => {
    expect(parseSchedule("")).toBeNull();
    expect(parseSchedule("   ")).toBeNull();
  });

  it("passes through raw cron expressions", () => {
    expect(parseSchedule("0 9 * * *")).toEqual({
      cron: "0 9 * * *",
      description: "0 9 * * *",
    });
    expect(parseSchedule("*/15 * * * 1-5")).toEqual({
      cron: "*/15 * * * 1-5",
      description: "*/15 * * * 1-5",
    });
  });

  it("parses hourly", () => {
    expect(parseSchedule("hourly")?.cron).toBe("0 * * * *");
    expect(parseSchedule("Every hour")?.cron).toBe("0 * * * *");
  });

  it("parses 'every N hours'", () => {
    expect(parseSchedule("every 4 hours")?.cron).toBe("0 */4 * * *");
    expect(parseSchedule("every 1 hour")?.cron).toBe("0 */1 * * *");
  });

  it("rejects out-of-range hour intervals", () => {
    expect(parseSchedule("every 0 hours")).toBeNull();
    expect(parseSchedule("every 24 hours")).toBeNull();
  });

  it("parses 'every N minutes'", () => {
    expect(parseSchedule("every 15 minutes")?.cron).toBe("*/15 * * * *");
  });

  it("parses daily at TIME", () => {
    expect(parseSchedule("daily at 9am")?.cron).toBe("0 9 * * *");
    expect(parseSchedule("every day at 5pm")?.cron).toBe("0 17 * * *");
    expect(parseSchedule("daily at 9:30am")?.cron).toBe("30 9 * * *");
    expect(parseSchedule("daily at noon")?.cron).toBe("0 12 * * *");
    expect(parseSchedule("daily at midnight")?.cron).toBe("0 0 * * *");
    expect(parseSchedule("daily at 14:30")?.cron).toBe("30 14 * * *");
  });

  it("handles 12am / 12pm correctly", () => {
    expect(parseSchedule("daily at 12am")?.cron).toBe("0 0 * * *");
    expect(parseSchedule("daily at 12pm")?.cron).toBe("0 12 * * *");
  });

  it("parses weekdays / weekends", () => {
    expect(parseSchedule("weekdays at 9am")?.cron).toBe("0 9 * * 1-5");
    expect(parseSchedule("every weekday at 5pm")?.cron).toBe("0 17 * * 1-5");
    expect(parseSchedule("weekends at 10am")?.cron).toBe("0 10 * * 0,6");
  });

  it("parses individual days of the week", () => {
    expect(parseSchedule("Mondays at 9am")?.cron).toBe("0 9 * * 1");
    expect(parseSchedule("every Tuesday at 5pm")?.cron).toBe("0 17 * * 2");
    expect(parseSchedule("Friday at 4pm")?.cron).toBe("0 16 * * 5");
    expect(parseSchedule("Sundays at noon")?.cron).toBe("0 12 * * 0");
  });

  it("parses 1st of month variants", () => {
    expect(parseSchedule("1st of the month at 9am")?.cron).toBe("0 9 1 * *");
    expect(parseSchedule("first of month at 9am")?.cron).toBe("0 9 1 * *");
    expect(parseSchedule("first of the month at noon")?.cron).toBe(
      "0 12 1 * *",
    );
  });

  it("parses Nth of month", () => {
    expect(parseSchedule("15th of the month at 9am")?.cron).toBe("0 9 15 * *");
    expect(parseSchedule("3 of month at 8am")?.cron).toBe("0 8 3 * *");
  });

  it("rejects nonsense", () => {
    expect(parseSchedule("blue chickens")).toBeNull();
    expect(parseSchedule("daily at half past nine")).toBeNull();
    expect(parseSchedule("every quarter")).toBeNull();
  });

  it("returns a friendly description for parsed values", () => {
    expect(parseSchedule("daily at 9am")?.description).toBe("Daily at 9am");
    expect(parseSchedule("every Tuesday at 5pm")?.description).toBe(
      "Tuesdays at 5pm",
    );
  });
});

describe("describeCron", () => {
  it("returns the friendly preset label when known", () => {
    expect(describeCron("0 9 * * *")).toBe("Daily at 9am");
    expect(describeCron("0 9 * * 1-5")).toBe("Weekdays at 9am");
    expect(describeCron("0 9 * * 1")).toBe("Mondays at 9am");
  });

  it("returns the raw cron when not a known preset", () => {
    expect(describeCron("*/15 * * * *")).toBe("*/15 * * * *");
    expect(describeCron("0 17 * * 2")).toBe("0 17 * * 2");
  });
});
