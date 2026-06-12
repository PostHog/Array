import { ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import { ArtefactLogList } from "@posthog/ui/features/inbox/components/detail/ArtefactLogList";
import { RightColumnSection } from "@posthog/ui/features/inbox/components/RightColumnSection";
import { useInboxReportArtefacts } from "@posthog/ui/features/inbox/hooks/useInboxReports";
import { Text } from "@radix-ui/themes";

/**
 * The report's artefact log ("Activity"), shared by every report detail
 * surface (reports, pull requests, runs) so the work log follows the report
 * wherever it is rendered. Renders nothing while loading or when the report
 * has no artefacts.
 */
export function ReportActivitySection({ reportId }: { reportId: string }) {
  const { data: artefactsResp } = useInboxReportArtefacts(reportId);
  const artefacts = artefactsResp?.results ?? [];

  if (artefacts.length === 0) return null;

  return (
    <RightColumnSection
      Icon={ClockCounterClockwiseIcon}
      title="Activity"
      rightSlot={
        <Text className="cursor-default select-none text-[11px] text-gray-10 tabular-nums">
          {artefacts.length} entr{artefacts.length === 1 ? "y" : "ies"}
        </Text>
      }
    >
      <ArtefactLogList reportId={reportId} artefacts={artefacts} />
    </RightColumnSection>
  );
}
