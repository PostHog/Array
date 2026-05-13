import { describe, expect, it } from "vitest";
import {
  cronForPreset,
  DEFAULT_PRESET_ID,
  labelForCron,
  nextRunForPreset,
  presetForCron,
  SCHEDULE_PRESETS,
} from "./schedulePresets";

describe("schedulePresets", () => {
  it("contains the default preset id", () => {
    expect(SCHEDULE_PRESETS.some((p) => p.id === DEFAULT_PRESET_ID)).toBe(true);
  });

  it("has unique preset ids", () => {
    const ids = SCHEDULE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique cron expressions", () => {
    const crons = SCHEDULE_PRESETS.map((p) => p.cron);
    expect(new Set(crons).size).toBe(crons.length);
  });

  it("round-trips id ↔ cron for every preset", () => {
    for (const preset of SCHEDULE_PRESETS) {
      expect(cronForPreset(preset.id)).toBe(preset.cron);
      expect(presetForCron(preset.cron)?.id).toBe(preset.id);
    }
  });

  it("cronForPreset throws for unknown id", () => {
    // @ts-expect-error - intentionally passing an invalid id
    expect(() => cronForPreset("not-a-real-preset")).toThrow();
  });

  it("presetForCron returns null for unknown cron", () => {
    expect(presetForCron("12 34 5 6 7")).toBeNull();
  });

  it("labelForCron returns the preset label when matched", () => {
    expect(labelForCron("0 9 * * *")).toBe("Daily at 9am");
  });

  it("labelForCron falls back to the raw cron string when unknown", () => {
    expect(labelForCron("*/15 * * * *")).toBe("*/15 * * * *");
  });
});

describe("nextRunForPreset", () => {
  it("always returns a Date strictly greater than `now`", () => {
    const now = new Date("2026-05-13T14:23:45");
    for (const preset of SCHEDULE_PRESETS) {
      const next = nextRunForPreset(preset.id, now);
      expect(next.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  describe("hourly", () => {
    it("rolls to the top of the next hour", () => {
      // 2026-05-13 Wed 14:23
      const now = new Date(2026, 4, 13, 14, 23, 45, 100);
      const next = nextRunForPreset("hourly", now);
      expect(next.getMinutes()).toBe(0);
      expect(next.getSeconds()).toBe(0);
      expect(next.getMilliseconds()).toBe(0);
      expect(next.getHours()).toBe(15);
      expect(next.getDate()).toBe(13);
    });

    it("rolls across day boundary at 23:xx", () => {
      const now = new Date(2026, 4, 13, 23, 50);
      const next = nextRunForPreset("hourly", now);
      expect(next.getDate()).toBe(14);
      expect(next.getHours()).toBe(0);
    });
  });

  describe("daily-9am", () => {
    it("returns today at 9am if before 9am", () => {
      const now = new Date(2026, 4, 13, 8, 0); // 8:00 Wed
      const next = nextRunForPreset("daily-9am", now);
      expect(next.getDate()).toBe(13);
      expect(next.getHours()).toBe(9);
      expect(next.getMinutes()).toBe(0);
    });

    it("returns tomorrow at 9am if past 9am", () => {
      const now = new Date(2026, 4, 13, 10, 0); // 10:00 Wed
      const next = nextRunForPreset("daily-9am", now);
      expect(next.getDate()).toBe(14);
      expect(next.getHours()).toBe(9);
    });

    it("returns tomorrow at 9am exactly at 9am", () => {
      const now = new Date(2026, 4, 13, 9, 0); // exactly 9:00 Wed
      const next = nextRunForPreset("daily-9am", now);
      expect(next.getDate()).toBe(14);
      expect(next.getHours()).toBe(9);
    });
  });

  describe("weekdays-9am", () => {
    it("returns today at 9am on a weekday morning", () => {
      const now = new Date(2026, 4, 13, 8, 0); // Wed 8:00
      const next = nextRunForPreset("weekdays-9am", now);
      expect(next.getDate()).toBe(13);
      expect(next.getDay()).toBe(3);
    });

    it("rolls to Monday from Friday afternoon", () => {
      // 2026-05-15 is Friday
      const friday = new Date(2026, 4, 15, 10, 0);
      const next = nextRunForPreset("weekdays-9am", friday);
      expect(next.getDay()).toBe(1); // Monday
    });

    it("rolls to Monday from Saturday morning before 9", () => {
      const saturday = new Date(2026, 4, 16, 8, 0);
      const next = nextRunForPreset("weekdays-9am", saturday);
      expect(next.getDay()).toBe(1);
    });

    it("rolls to Monday from Sunday afternoon", () => {
      const sunday = new Date(2026, 4, 17, 16, 0);
      const next = nextRunForPreset("weekdays-9am", sunday);
      expect(next.getDay()).toBe(1);
    });
  });

  describe("monday-9am", () => {
    it("returns today at 9am on Monday morning before 9", () => {
      // 2026-05-11 is Monday
      const now = new Date(2026, 4, 11, 8, 0);
      const next = nextRunForPreset("monday-9am", now);
      expect(next.getDay()).toBe(1);
      expect(next.getDate()).toBe(11);
    });

    it("rolls to next Monday from Monday afternoon", () => {
      const now = new Date(2026, 4, 11, 10, 0);
      const next = nextRunForPreset("monday-9am", now);
      expect(next.getDay()).toBe(1);
      expect(next.getDate()).toBe(18);
    });

    it("rolls forward from Wednesday morning before 9", () => {
      const now = new Date(2026, 4, 13, 8, 0); // Wed
      const next = nextRunForPreset("monday-9am", now);
      expect(next.getDay()).toBe(1);
      expect(next.getDate()).toBe(18); // following Monday
    });
  });

  describe("monthly-1st-9am", () => {
    it("returns today at 9am on the 1st before 9", () => {
      const now = new Date(2026, 4, 1, 8, 0);
      const next = nextRunForPreset("monthly-1st-9am", now);
      expect(next.getDate()).toBe(1);
      expect(next.getMonth()).toBe(4);
    });

    it("rolls to next month from the 1st past 9am", () => {
      const now = new Date(2026, 4, 1, 10, 0);
      const next = nextRunForPreset("monthly-1st-9am", now);
      expect(next.getDate()).toBe(1);
      expect(next.getMonth()).toBe(5);
    });

    it("rolls to next month from mid-month", () => {
      const now = new Date(2026, 4, 15, 12, 0);
      const next = nextRunForPreset("monthly-1st-9am", now);
      expect(next.getDate()).toBe(1);
      expect(next.getMonth()).toBe(5);
    });

    it("handles Dec → Jan year roll", () => {
      const now = new Date(2026, 11, 20, 12, 0);
      const next = nextRunForPreset("monthly-1st-9am", now);
      expect(next.getDate()).toBe(1);
      expect(next.getMonth()).toBe(0);
      expect(next.getFullYear()).toBe(2027);
    });

    it("returns the 1st of next month from the 31st", () => {
      const now = new Date(2026, 0, 31, 12, 0);
      const next = nextRunForPreset("monthly-1st-9am", now);
      expect(next.getDate()).toBe(1);
      expect(next.getMonth()).toBe(1);
    });
  });
});
