import type { DashboardDateRange } from "@posthog/core/canvas/dashboardSchemas";
import { CUSTOM_RANGE, type DateTimeValue, quickRanges } from "@posthog/quill";

// The default window a data canvas opens on when nothing is stored yet.
export const DEFAULT_RANGE_NAME = "Last 7 days";

// A range whose end is within this of now reads as "Now" in the label, and a
// stored name that matches a quick range (and isn't "Custom") is a *rolling*
// window — it follows the clock instead of pinning to the moment it was picked.
const NOW_TOLERANCE_MS = 90_000;

export function rangeByName(name: string) {
  return quickRanges.find((r) => r.name === name);
}

// The window stored on a canvas spec (under state.dateRange), or null. One place
// owns the cast so the on-spec location isn't hardcoded across call sites.
export function readStoredRange(spec: unknown): DashboardDateRange | null {
  const r = (
    spec as { state?: { dateRange?: DashboardDateRange } } | null | undefined
  )?.state?.dateRange;
  return r ?? null;
}

function isNamed(stored: DashboardDateRange | null): boolean {
  return (
    !!stored &&
    stored.name !== "Custom" &&
    rangeByName(stored.name) !== undefined
  );
}

// Resolve the window to actually query NOW. Named/quick ranges ("Last 7 days")
// roll: recompute from the current instant via quill's rangeSetter (the same
// logic the picker uses). "Custom" stays pinned to its stored absolute from/to.
export function liveWindow(
  stored: DashboardDateRange | null,
): DashboardDateRange | null {
  if (!stored) return null;
  const r = rangeByName(stored.name);
  if (r && stored.name !== "Custom") {
    const to = Date.now();
    return {
      name: stored.name,
      from: r.rangeSetter(new Date(to)).getTime(),
      to,
    };
  }
  return stored; // Custom: a fixed window is the whole point — don't roll it.
}

// The picker's value, rolled for named ranges; default to "Last 7 days" at now.
export function toPickerValue(range: DashboardDateRange | null): DateTimeValue {
  if (!range) {
    const r = rangeByName(DEFAULT_RANGE_NAME) ?? quickRanges[0];
    return { start: r.rangeSetter(new Date()), end: new Date(), range: r };
  }
  const r = rangeByName(range.name) ?? CUSTOM_RANGE;
  return { start: new Date(range.from), end: new Date(range.to), range: r };
}

// Trigger label: the name for a rolling quick range, else a human-readable
// absolute window ("10:01:59 31/9/2026 - 11:01:59 31/9/2026", or "… - Now").
export function formatRangeLabel(stored: DashboardDateRange | null): string {
  if (!stored) return DEFAULT_RANGE_NAME;
  if (isNamed(stored)) return stored.name;
  const end =
    Math.abs(Date.now() - stored.to) < NOW_TOLERANCE_MS
      ? "Now"
      : formatDateTime(stored.to);
  return `${formatDateTime(stored.from)} - ${end}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Local-time "HH:MM:SS D/M/YYYY" (the stored value is epoch ms / UTC-agnostic).
function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${time} ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}
