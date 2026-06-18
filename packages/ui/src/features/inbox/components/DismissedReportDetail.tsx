import {
  ArrowCounterClockwiseIcon,
  CopyIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import {
  isAgentRunReport,
  isPullRequestReport,
} from "@posthog/core/inbox/reportMembership";
import { Button } from "@posthog/quill";
import type { SignalReport } from "@posthog/shared/types";
import { InboxDetailFrame } from "@posthog/ui/features/inbox/components/InboxDetailFrame";
import { InboxReportDetailGate } from "@posthog/ui/features/inbox/components/InboxReportDetailGate";
import { useInboxReportById } from "@posthog/ui/features/inbox/hooks/useInboxReports";
import { useInboxRestoreReport } from "@posthog/ui/features/inbox/hooks/useInboxRestoreReport";
import { copyInboxReportLink } from "@posthog/ui/features/inbox/utils/copyInboxReportLink";
import { Flex, Spinner } from "@radix-ui/themes";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

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

/**
 * Detail route a non-suppressed report should be viewed at, by the same
 * tab-membership predicates the inbox tabs use: Pulls when a PR exists, Runs
 * while the run is in flight, otherwise Reports.
 */
function nonSuppressedDetailRoute(
  report: SignalReport,
):
  | "/code/inbox/pulls/$reportId"
  | "/code/inbox/runs/$reportId"
  | "/code/inbox/reports/$reportId" {
  if (isPullRequestReport(report)) return "/code/inbox/pulls/$reportId";
  if (isAgentRunReport(report)) return "/code/inbox/runs/$reportId";
  return "/code/inbox/reports/$reportId";
}

function DismissedReportDetailContent({ report }: { report: SignalReport }) {
  const navigate = useNavigate();
  // Shares the gate's detail query (same key, deduped) for its fetch state.
  const { isFetching } = useInboxReportById(report.id);

  // A dismissed-detail URL can go stale — browser history, a bookmark, or a
  // copied deep link — after the report was restored and moved on. Restoring a
  // non-suppressed report would silently re-queue it (READY/RESOLVED → POTENTIAL
  // is an allowed server-side transition), so redirect such reports to wherever
  // they now live instead of rendering the read-only dismissed view with Restore.
  //
  // Gate the redirect on a settled fetch (`!isFetching`): right after a dismissal
  // the shared cache still holds the pre-dismissal record (the suppress mutation
  // invalidates but doesn't rewrite it), and redirecting on that stale snapshot
  // would bounce the user out of a report that really is dismissed. The detail
  // query forces a fresh fetch on mount (`initialDataUpdatedAt: 0`), so this just
  // waits for the real status to land.
  const isDismissed = report.status === "suppressed";
  const redirectTo =
    !isDismissed && !isFetching ? nonSuppressedDetailRoute(report) : null;
  useEffect(() => {
    if (!redirectTo) return;
    navigate({
      to: redirectTo,
      params: { reportId: report.id },
      replace: true,
    });
  }, [redirectTo, navigate, report.id]);

  if (!isDismissed) {
    return (
      <Flex align="center" justify="center" className="py-16">
        <Spinner />
      </Flex>
    );
  }

  return (
    <InboxDetailFrame
      report={report}
      backTo="/code/inbox/dismissed"
      backLabel="Back to dismissed"
      fallbackTitle="Untitled report"
      showDismiss={false}
      primaryAction={
        <>
          <RestoreReportButton report={report} />
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
