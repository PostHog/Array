import { differenceInHours, format, formatDistanceToNow } from "date-fns";

/** Relative time for the last day, absolute "MMM d" beyond it. */
export function formatReportTimestamp(date: Date): string {
  return differenceInHours(new Date(), date) < 24
    ? formatDistanceToNow(date, { addSuffix: true })
    : format(date, "MMM d");
}
