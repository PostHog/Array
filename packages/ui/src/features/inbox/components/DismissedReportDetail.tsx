import {
  ArrowCounterClockwiseIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import type { SignalReport } from "@posthog/shared/types";
import { InboxDetailFrame } from "@posthog/ui/features/inbox/components/InboxDetailFrame";
import { InboxReportDetailGate } from "@posthog/ui/features/inbox/components/InboxReportDetailGate";
import { useInboxRestoreReport } from "@posthog/ui/features/inbox/hooks/useInboxRestoreReport";
import { Spinner } from "@radix-ui/themes";
import { useNavigate } from "@tanstack/react-router";

interface DismissedReportDetailProps {
  reportId: string;
  cachedReport?: SignalReport | null;
}

/**
 * Detail view for a dismissed (suppressed) report. Read-only re-read of what the
 * report was — summary + evidence — with a single Restore action. No triage
 * affordances (dismiss, discuss, create PR, reviewers): the report is out of the
 * pipeline until it's restored.
 */
export function DismissedReportDetail({
  reportId,
  cachedReport = null,
}: DismissedReportDetailProps) {
  return (
    <InboxReportDetailGate
      reportId={reportId}
      cachedReport={cachedReport}
      backTo="/code/inbox/dismissed"
      backLabel="Back to dismissed"
      missingCopy="This report couldn't be found. It may have been deleted."
    >
      {(report) => <DismissedReportDetailContent report={report} />}
    </InboxReportDetailGate>
  );
}

function DismissedReportDetailContent({ report }: { report: SignalReport }) {
  return (
    <InboxDetailFrame
      report={report}
      backTo="/code/inbox/dismissed"
      backLabel="Back to dismissed"
      fallbackTitle="Untitled report"
      showDismiss={false}
      primaryAction={<RestoreReportButton report={report} />}
      summarySection={{ Icon: FileTextIcon, title: "Summary" }}
      evidenceSection={{ Icon: MagnifyingGlassIcon, title: "Evidence" }}
    />
  );
}

function RestoreReportButton({ report }: { report: SignalReport }) {
  const restore = useInboxRestoreReport();
  const navigate = useNavigate();

  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      disabled={restore.isPending}
      className="gap-1"
      title="Restore this report to the inbox"
      onClick={() =>
        restore.mutate(report.id, {
          onSuccess: () => navigate({ to: "/code/inbox/dismissed" }),
        })
      }
    >
      {restore.isPending ? (
        <Spinner size="1" />
      ) : (
        <ArrowCounterClockwiseIcon size={12} />
      )}
      Restore
    </Button>
  );
}
