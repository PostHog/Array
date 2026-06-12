import { Spinner } from "@posthog/quill";
import type { SignalReport } from "@posthog/shared/types";
import { DetailBackLink } from "@posthog/ui/features/inbox/components/DetailBackLink";
import { useInboxReportById } from "@posthog/ui/features/inbox/hooks/useInboxReports";
import { Flex, Text } from "@radix-ui/themes";
import type { ReactNode } from "react";

interface InboxReportDetailGateProps {
  reportId: string;
  cachedReport?: SignalReport | null;
  backTo: "/code/inbox/pulls" | "/code/inbox/reports" | "/code/inbox/runs";
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

  return <>{children(resolvedReport)}</>;
}
