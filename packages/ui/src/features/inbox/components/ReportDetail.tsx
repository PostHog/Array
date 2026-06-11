import {
  ClockCounterClockwiseIcon,
  CopyIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import type { SignalReport } from "@posthog/shared/types";
import { ArtefactLogList } from "@posthog/ui/features/inbox/components/detail/ArtefactLogList";
import { InboxDetailFrame } from "@posthog/ui/features/inbox/components/InboxDetailFrame";
import { InboxReportDetailGate } from "@posthog/ui/features/inbox/components/InboxReportDetailGate";
import { ReportDetailActions } from "@posthog/ui/features/inbox/components/ReportDetailActions";
import { ReportTasksSection } from "@posthog/ui/features/inbox/components/ReportTasksSection";
import { RightColumnSection } from "@posthog/ui/features/inbox/components/RightColumnSection";
import { SuggestedReviewersSection } from "@posthog/ui/features/inbox/components/SuggestedReviewersSection";
import { useInboxReportArtefacts } from "@posthog/ui/features/inbox/hooks/useInboxReports";
import { copyInboxReportLink } from "@posthog/ui/features/inbox/utils/copyInboxReportLink";
import { Text } from "@radix-ui/themes";

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
  const { data: artefactsResp } = useInboxReportArtefacts(report.id);
  const artefacts = artefactsResp?.results ?? [];

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
            onClick={() => copyInboxReportLink(report)}
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
      {artefacts.length > 0 ? (
        <RightColumnSection
          Icon={ClockCounterClockwiseIcon}
          title="Activity"
          rightSlot={
            <Text className="cursor-default select-none text-[11px] text-gray-10 tabular-nums">
              {artefacts.length} entr{artefacts.length === 1 ? "y" : "ies"}
            </Text>
          }
        >
          <ArtefactLogList reportId={report.id} artefacts={artefacts} />
        </RightColumnSection>
      ) : null}
    </InboxDetailFrame>
  );
}
