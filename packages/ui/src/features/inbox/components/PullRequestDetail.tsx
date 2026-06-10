import {
  ArrowSquareOutIcon,
  GitPullRequestIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { parsePrUrl } from "@posthog/core/inbox/reportPresentation";
import { Button } from "@posthog/quill";
import type { SignalReport } from "@posthog/shared/types";
import { InboxDetailFrame } from "@posthog/ui/features/inbox/components/InboxDetailFrame";
import { InboxMetaSeparator } from "@posthog/ui/features/inbox/components/InboxMetaRow";
import { InboxReportDetailGate } from "@posthog/ui/features/inbox/components/InboxReportDetailGate";
import { PrDiffStats } from "@posthog/ui/features/inbox/components/PrDiffStats";
import { ReportDetailActions } from "@posthog/ui/features/inbox/components/ReportDetailActions";
import { ReportTasksSection } from "@posthog/ui/features/inbox/components/ReportTasksSection";
import { SuggestedReviewersSection } from "@posthog/ui/features/inbox/components/SuggestedReviewersSection";
import { Text } from "@radix-ui/themes";

interface PullRequestDetailProps {
  reportId: string;
  cachedReport?: SignalReport | null;
}

export function PullRequestDetail({
  reportId,
  cachedReport = null,
}: PullRequestDetailProps) {
  return (
    <InboxReportDetailGate
      reportId={reportId}
      cachedReport={cachedReport}
      backTo="/code/inbox/pulls"
      backLabel="Back to pull requests"
      missingCopy="This pull request couldn't be found. It may have been deleted."
    >
      {(report) => <PullRequestDetailContent report={report} />}
    </InboxReportDetailGate>
  );
}

function PullRequestDetailContent({ report }: { report: SignalReport }) {
  const prRef = report.implementation_pr_url
    ? parsePrUrl(report.implementation_pr_url)
    : null;

  return (
    <InboxDetailFrame
      report={report}
      backTo="/code/inbox/pulls"
      backLabel="Back to pull requests"
      fallbackTitle="Untitled pull request"
      breadcrumb={
        prRef ? (
          <>
            <span className="text-(--gray-8)">/</span>
            <Text className="font-mono text-[12px] text-gray-11">
              {prRef.repoSlug}#{prRef.number}
            </Text>
          </>
        ) : undefined
      }
      metaSuffix={
        report.implementation_pr_url ? (
          <>
            <InboxMetaSeparator />
            <PrDiffStats
              prUrl={report.implementation_pr_url}
              hideWhileLoading
            />
          </>
        ) : undefined
      }
      primaryAction={
        <>
          <ReportDetailActions report={report} />
          {prRef && report.implementation_pr_url ? (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                // `prRef` non-null already proves the URL is canonical GitHub.
                window.open(
                  report.implementation_pr_url ?? "",
                  "_blank",
                  "noopener",
                );
              }}
              className="gap-2"
            >
              Open in GitHub
              <ArrowSquareOutIcon size={12} />
            </Button>
          ) : null}
        </>
      }
      summarySection={{ Icon: GitPullRequestIcon, title: "Summary" }}
      evidenceSection={{ Icon: MagnifyingGlassIcon, title: "Evidence" }}
    >
      <ReportTasksSection report={report} />
      <SuggestedReviewersSection report={report} />
    </InboxDetailFrame>
  );
}
