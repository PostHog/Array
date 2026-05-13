export const SCHEDULE_PRESETS = [
  { id: "hourly", label: "Every hour", cron: "0 * * * *" },
  { id: "daily-9am", label: "Daily at 9am", cron: "0 9 * * *" },
  { id: "weekdays-9am", label: "Weekdays at 9am", cron: "0 9 * * 1-5" },
  { id: "monday-9am", label: "Mondays at 9am", cron: "0 9 * * 1" },
  { id: "monthly-1st-9am", label: "1st of month at 9am", cron: "0 9 1 * *" },
] as const;

export type SchedulePreset = (typeof SCHEDULE_PRESETS)[number];
export type SchedulePresetId = SchedulePreset["id"];

export const DEFAULT_PRESET_ID: SchedulePresetId = "daily-9am";

export function presetForCron(cron: string): SchedulePreset | null {
  return SCHEDULE_PRESETS.find((preset) => preset.cron === cron) ?? null;
}

export function cronForPreset(id: SchedulePresetId): string {
  const preset = SCHEDULE_PRESETS.find((p) => p.id === id);
  if (!preset) {
    throw new Error(`Unknown schedule preset: ${id}`);
  }
  return preset.cron;
}

export function labelForCron(cron: string): string {
  return presetForCron(cron)?.label ?? cron;
}

/**
 * Compute the next fire time for a preset relative to `now`, in the local timezone.
 * Returned Date is always strictly greater than `now`.
 */
export function nextRunForPreset(
  presetId: SchedulePresetId,
  now: Date = new Date(),
): Date {
  const next = new Date(now);

  switch (presetId) {
    case "hourly": {
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      return next;
    }
    case "daily-9am": {
      next.setHours(9, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return next;
    }
    case "weekdays-9am": {
      next.setHours(9, 0, 0, 0);
      if (next <= now || isWeekend(next)) {
        next.setDate(next.getDate() + 1);
      }
      while (isWeekend(next)) {
        next.setDate(next.getDate() + 1);
      }
      return next;
    }
    case "monday-9am": {
      next.setHours(9, 0, 0, 0);
      if (next <= now || next.getDay() !== 1) {
        next.setDate(next.getDate() + 1);
      }
      while (next.getDay() !== 1) {
        next.setDate(next.getDate() + 1);
      }
      return next;
    }
    case "monthly-1st-9am": {
      next.setHours(9, 0, 0, 0);
      if (next.getDate() !== 1 || next <= now) {
        next.setMonth(next.getMonth() + 1, 1);
        next.setHours(9, 0, 0, 0);
      }
      return next;
    }
  }
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}
