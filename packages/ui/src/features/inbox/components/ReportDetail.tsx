import {
  CopyIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import type { SignalReport } from "@posthog/shared/types";
import { InboxDetailFrame } from "@posthog/ui/features/inbox/components/InboxDetailFrame";
import { InboxReportDetailGate } from "@posthog/ui/features/inbox/components/InboxReportDetailGate";
import { ReportDetailActions } from "@posthog/ui/features/inbox/components/ReportDetailActions";
import { ReportTasksSection } from "@posthog/ui/features/inbox/components/ReportTasksSection";
import { SuggestedReviewersSection } from "@posthog/ui/features/inbox/components/SuggestedReviewersSection";
import { toast } from "sonner";

interface ReportDetailProps {
  reportId: string;
  cachedReport?: SignalReport | null;
}

export function ReportDetail({
  reportId,
  cachedReport = null,
}: ReportDetailProps) {
  return (
    <InboxReportDetailGate
      reportId={reportId}
      cachedReport={cachedReport}
      backTo="/code/inbox/reports"
      backLabel="Back to reports"
      missingCopy="This report couldn't be found. It may have been deleted."
    >
      {(report) => <ReportDetailContent report={report} />}
    </InboxReportDetailGate>
  );
}

function ReportDetailContent({ report }: { report: SignalReport }) {
  const handleCopyLink = () => {
    const url = `${window.location.origin}/code/inbox/reports/${report.id}`;
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Link copied"))
      .catch(() => toast.error("Couldn't copy link"));
  };

  return (
    <InboxDetailFrame
      report={report}
      backTo="/code/inbox/reports"
      backLabel="Back to reports"
      fallbackTitle="Untitled report"
      primaryAction={
        <>
          <ReportDetailActions report={report} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyLink}
            title="Copy a deep link to this report"
          >
            <CopyIcon size={12} />
          </Button>
        </>
      }
      summarySection={{ Icon: FileTextIcon, title: "Summary" }}
      evidenceSection={{ Icon: MagnifyingGlassIcon, title: "Evidence" }}
    >
      <ReportTasksSection report={report} />
      <SuggestedReviewersSection report={report} />
    </InboxDetailFrame>
  );
}
