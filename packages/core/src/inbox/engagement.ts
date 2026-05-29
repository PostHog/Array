import type { InboxReportActionProperties } from "@posthog/shared/analytics-events";
import type { SignalReport } from "@posthog/shared/domain-types";

/** Report age at fire time in hours, rounded to one decimal. Clamped at 0 to guard against clock skew. */
export function reportAgeHours(createdAt: string | null | undefined): number {
  if (!createdAt) return 0;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  if (!Number.isFinite(ageMs)) return 0;
  return Math.max(0, Math.round((ageMs / 3_600_000) * 10) / 10);
}

/** Live tracker snapshot for the currently-open report. */
export interface OpenReportSnapshot {
  reportId: string;
  rank: number;
  reportPriority: string | null;
  reportActionability: string | null;
}

export type ResolvedActionProperties = Pick<
  InboxReportActionProperties,
  "rank" | "list_size" | "priority" | "actionability"
>;

export interface ResolveActionPropertiesInput {
  reportId: string;
  rankOverride?: number;
  listSizeOverride?: number;
  priorityOverride?: string | null;
  actionabilityOverride?: string | null;
  openSnapshot: OpenReportSnapshot | null;
  visibleReports: SignalReport[];
}

/**
 * Resolve rank / list_size / priority / actionability for an INBOX_REPORT_ACTION event.
 *
 * Precedence: explicit override -> live open-info snapshot (current report only) ->
 * a one-shot lookup in the visible list. Callers firing after an async mutation should
 * pass pre-mutation overrides; by then the visible list has been re-queried without the
 * affected report.
 */
export function resolveActionProperties(
  input: ResolveActionPropertiesInput,
): ResolvedActionProperties {
  const {
    reportId,
    rankOverride,
    listSizeOverride,
    priorityOverride,
    actionabilityOverride,
    openSnapshot,
    visibleReports,
  } = input;

  const currentInfo =
    openSnapshot && openSnapshot.reportId === reportId ? openSnapshot : null;
  const matchedReport = currentInfo
    ? null
    : (visibleReports.find((r) => r.id === reportId) ?? null);

  const rank =
    rankOverride !== undefined
      ? rankOverride
      : currentInfo
        ? currentInfo.rank
        : visibleReports.findIndex((r) => r.id === reportId);
  const listSize =
    listSizeOverride !== undefined ? listSizeOverride : visibleReports.length;
  const priority =
    priorityOverride !== undefined
      ? priorityOverride
      : currentInfo
        ? currentInfo.reportPriority
        : (matchedReport?.priority ?? null);
  const actionability =
    actionabilityOverride !== undefined
      ? actionabilityOverride
      : currentInfo
        ? currentInfo.reportActionability
        : (matchedReport?.actionability ?? null);

  return { rank, list_size: listSize, priority, actionability };
}
