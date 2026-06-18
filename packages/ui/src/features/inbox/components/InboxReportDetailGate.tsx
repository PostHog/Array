import { Spinner } from "@posthog/quill";
import type { SignalReport } from "@posthog/shared/types";
import { DetailBackLink } from "@posthog/ui/features/inbox/components/DetailBackLink";
import { useInboxReportById } from "@posthog/ui/features/inbox/hooks/useInboxReports";
import {
  type InboxDetailTab,
  useReportOpenTracker,
} from "@posthog/ui/features/inbox/hooks/useReportOpenTracker";
import { Flex, Text } from "@radix-ui/themes";
import type { ReactNode } from "react";

interface InboxReportDetailGateProps {
  reportId: string;
  cachedReport?: SignalReport | null;
  backTo:
    | "/code/inbox/pulls"
    | "/code/inbox/reports"
    | "/code/inbox/runs"
    | "/code/inbox/dismissed";
  backLabel: string;
  missingCopy: string;
  children: (report: SignalReport) => ReactNode;
}

/**
 * Shared loading + missing-report shell for inbox detail screens. The actual
 * detail body is rendered by the `children` render prop once the report is
 * resolved (either from the fresh query or from the cached/seeded report).
 */
export function InboxReportDetailGate({
  reportId,
  cachedReport = null,
  backTo,
  backLabel,
  missingCopy,
  children,
}: InboxReportDetailGateProps) {
  const { data: report, isLoading } = useInboxReportById(reportId);
  const resolvedReport = report ?? cachedReport;

  if (isLoading && !resolvedReport) {
    return (
      <Flex align="center" justify="center" className="py-16">
        <Spinner />
      </Flex>
    );
  }

  if (!resolvedReport) {
    return (
      <Flex direction="column" className="h-full min-h-0">
        <Flex
          direction="column"
          gap="3"
          className="border-(--gray-5) border-b px-6 py-6"
        >
          <DetailBackLink to={backTo} label={backLabel} />
          <Text className="text-[13px] text-gray-11">{missingCopy}</Text>
        </Flex>
      </Flex>
    );
  }

  const trackTab = tabFromBackTo(backTo);
  return (
    <>
      {trackTab && <ReportOpenTracker report={resolvedReport} tab={trackTab} />}
      {children(resolvedReport)}
    </>
  );
}

/**
 * The Dismissed tab isn't part of the triage funnel and isn't a tracked
 * `InboxDetailTab` (its rank would be measured against the wrong list), so it
 * returns `null` and the open/close engagement events are skipped for it.
 */
function tabFromBackTo(
  backTo: InboxReportDetailGateProps["backTo"],
): InboxDetailTab | null {
  if (backTo === "/code/inbox/pulls") return "pulls";
  if (backTo === "/code/inbox/runs") return "runs";
  if (backTo === "/code/inbox/dismissed") return null;
  return "reports";
}

/**
 * Mounts only once a report is resolved, so the OPENED/CLOSED engagement events
 * bracket the time the detail body is actually on screen. Renders nothing.
 */
function ReportOpenTracker({
  report,
  tab,
}: {
  report: SignalReport;
  tab: InboxDetailTab;
}) {
  useReportOpenTracker(report, tab);
  return null;
}
