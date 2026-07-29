import type { SignalReport } from "@posthog/shared/types";

/**
 * Report age at fire time in hours, for the `report_age_hours` property every
 * inbox event carries. Clamped at 0 so clock skew can't produce a negative age.
 */
export function reportAgeHours(report: SignalReport): number {
  const created = report.created_at ? new Date(report.created_at).getTime() : 0;
  if (!created) return 0;
  return Math.max(0, (Date.now() - created) / 36e5);
}
