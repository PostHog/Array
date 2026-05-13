/**
 * Small natural-language → cron parser for the scheduled-task editor.
 *
 * Supports common patterns a non-engineer would type. Returns null when it
 * can't make sense of the input — the caller surfaces "couldn't understand"
 * and blocks save in that case. Raw 5-field cron expressions pass through.
 */

const DAY_INDEX: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const DAY_DISPLAY = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];

interface ParsedTime {
  h: number;
  m: number;
}

function parseTime(input: string): ParsedTime | null {
  const text = input.trim().toLowerCase();
  if (text === "noon") return { h: 12, m: 0 };
  if (text === "midnight") return { h: 0, m: 0 };
  const match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let h = Number.parseInt(match[1], 10);
  const m = match[2] ? Number.parseInt(match[2], 10) : 0;
  const ampm = match[3];
  if (ampm === "am") {
    if (h === 12) h = 0;
  } else if (ampm === "pm") {
    if (h !== 12) h += 12;
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

function formatTime(t: ParsedTime): string {
  const period = t.h >= 12 ? "pm" : "am";
  const h12 = t.h === 0 ? 12 : t.h > 12 ? t.h - 12 : t.h;
  if (t.m === 0) return `${h12}${period}`;
  return `${h12}:${String(t.m).padStart(2, "0")}${period}`;
}

const DAY_KEY_PATTERN = Object.keys(DAY_INDEX)
  .sort((a, b) => b.length - a.length)
  .join("|");

export interface ParseResult {
  cron: string;
  description: string;
}

/**
 * Returns a cron expression + a friendly description, or null if the input
 * can't be parsed.
 */
export function parseSchedule(input: string): ParseResult | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  // Raw cron: exactly 5 whitespace-separated tokens of cron-shaped chars.
  // Pass through unchanged so users can paste a real cron expression too.
  const CRON_FIELD = "[0-9*,\\-/]+";
  if (new RegExp(`^${CRON_FIELD}(?:\\s+${CRON_FIELD}){4}$`).test(text)) {
    return { cron: text, description: text };
  }

  // Hourly
  if (text === "hourly" || text === "every hour") {
    return { cron: "0 * * * *", description: "Every hour" };
  }

  // Every N hours
  let m = text.match(/^every\s+(\d+)\s+hours?$/);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    if (n < 1 || n > 23) return null;
    return { cron: `0 */${n} * * *`, description: `Every ${n} hours` };
  }

  // Every N minutes
  m = text.match(/^every\s+(\d+)\s+minutes?$/);
  if (m) {
    const n = Number.parseInt(m[1], 10);
    if (n < 1 || n > 59) return null;
    return { cron: `*/${n} * * * *`, description: `Every ${n} minutes` };
  }

  // Daily / every day at TIME
  m = text.match(/^(?:daily|every\s+day)\s+at\s+(.+)$/);
  if (m) {
    const time = parseTime(m[1]);
    if (!time) return null;
    return {
      cron: `${time.m} ${time.h} * * *`,
      description: `Daily at ${formatTime(time)}`,
    };
  }

  // Weekdays / every weekday at TIME
  m = text.match(/^(?:weekdays|every\s+weekday)\s+at\s+(.+)$/);
  if (m) {
    const time = parseTime(m[1]);
    if (!time) return null;
    return {
      cron: `${time.m} ${time.h} * * 1-5`,
      description: `Weekdays at ${formatTime(time)}`,
    };
  }

  // Weekends at TIME
  m = text.match(/^(?:weekends|every\s+weekend)\s+at\s+(.+)$/);
  if (m) {
    const time = parseTime(m[1]);
    if (!time) return null;
    return {
      cron: `${time.m} ${time.h} * * 0,6`,
      description: `Weekends at ${formatTime(time)}`,
    };
  }

  // <Day(s)> at TIME, optionally "every <Day> at TIME"
  m = text.match(
    new RegExp(`^(?:every\\s+)?(${DAY_KEY_PATTERN})s?\\s+at\\s+(.+)$`),
  );
  if (m) {
    const day = DAY_INDEX[m[1]];
    const time = parseTime(m[2]);
    if (!time) return null;
    return {
      cron: `${time.m} ${time.h} * * ${day}`,
      description: `${DAY_DISPLAY[day]} at ${formatTime(time)}`,
    };
  }

  // 1st of (the) month at TIME / first of month at TIME
  m = text.match(/^(?:1st|first)\s+of\s+(?:the\s+)?month\s+at\s+(.+)$/);
  if (m) {
    const time = parseTime(m[1]);
    if (!time) return null;
    return {
      cron: `${time.m} ${time.h} 1 * *`,
      description: `1st of month at ${formatTime(time)}`,
    };
  }

  // Nth of (the) month at TIME (e.g. "15th of the month at 9am")
  m = text.match(/^(\d+)(?:st|nd|rd|th)?\s+of\s+(?:the\s+)?month\s+at\s+(.+)$/);
  if (m) {
    const dom = Number.parseInt(m[1], 10);
    if (dom < 1 || dom > 31) return null;
    const time = parseTime(m[2]);
    if (!time) return null;
    return {
      cron: `${time.m} ${time.h} ${dom} * *`,
      description: `Day ${dom} of month at ${formatTime(time)}`,
    };
  }

  return null;
}

/**
 * Inverse — best effort. Used to seed the schedule field with friendly
 * text when an existing automation's cron matches a known pattern.
 * Returns the original cron string when nothing matches (the parser
 * accepts raw cron pass-through, so the UI still works either way).
 */
export function describeCron(cron: string): string {
  switch (cron.trim()) {
    case "0 * * * *":
      return "Every hour";
    case "0 9 * * *":
      return "Daily at 9am";
    case "0 9 * * 1-5":
      return "Weekdays at 9am";
    case "0 9 * * 1":
      return "Mondays at 9am";
    case "0 9 1 * *":
      return "1st of month at 9am";
    default:
      return cron;
  }
}
