import { ArchiveIcon } from "@phosphor-icons/react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@posthog/quill";
import { CardSkeleton } from "@posthog/ui/features/inbox/components/CardSkeleton";
import { DismissedReportCard } from "@posthog/ui/features/inbox/components/DismissedReportCard";
import { useInboxDismissedReports } from "@posthog/ui/features/inbox/hooks/useInboxDismissedReports";
import { useInboxRestoreReport } from "@posthog/ui/features/inbox/hooks/useInboxRestoreReport";
import { Flex } from "@radix-ui/themes";

/**
 * Dismissed tab: reports the user has dismissed (suppressed) from the inbox,
 * newest first. Each card can be restored back into the pipeline. Read-only
 * otherwise — suppressed reports have no reachable detail page.
 */
export function DismissedTab() {
  const { reports, isLoading } = useInboxDismissedReports();
  const restore = useInboxRestoreReport();
  const restoringId = restore.isPending ? restore.variables : null;

  if (isLoading && reports.length === 0) {
    return (
      <Flex direction="column" gap="4" className="mx-auto max-w-4xl px-6 py-4">
        <CardSkeleton count={4} variant="cards" />
      </Flex>
    );
  }

  if (reports.length === 0) {
    return (
      <Flex direction="column" className="mx-auto max-w-4xl px-6 py-4">
        <Empty className="mx-auto max-w-md py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ArchiveIcon size={24} />
            </EmptyMedia>
            <EmptyTitle>No dismissed reports</EmptyTitle>
            <EmptyDescription>
              Reports you dismiss from your inbox show up here. You can restore
              any of them back to the inbox.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="3" className="mx-auto max-w-4xl px-6 py-4">
      {reports.map((report) => (
        <DismissedReportCard
          key={report.id}
          report={report}
          onRestore={() => restore.mutate(report.id)}
          isRestorePending={restoringId === report.id}
        />
      ))}
    </Flex>
  );
}
