import { LightningIcon, ThumbsDownIcon } from "@phosphor-icons/react";
import { extractRepoSelectionRepository } from "@posthog/core/inbox/artefacts";
import {
  deriveHeadline,
  displayConventionalCommitTitle,
  parseConventionalCommitTitle,
} from "@posthog/core/inbox/reportPresentation";
import { Button, cn } from "@posthog/quill";
import type { SignalReport } from "@posthog/shared/types";
import { ConventionalCommitScopeTag } from "@posthog/ui/features/inbox/components/ConventionalCommitScopeTag";
import { InboxCardSourceMeta } from "@posthog/ui/features/inbox/components/InboxCardSourceMeta";
import { InboxCardTitle } from "@posthog/ui/features/inbox/components/InboxCardTitle";
import { PriorityMonogram } from "@posthog/ui/features/inbox/components/PriorityMonogram";
import { SuggestedReviewerAvatarStack } from "@posthog/ui/features/inbox/components/SuggestedReviewerAvatarStack";
import { ForYouBadge } from "@posthog/ui/features/inbox/components/utils/ForYouBadge";
import { SignalReportActionabilityBadge } from "@posthog/ui/features/inbox/components/utils/SignalReportActionabilityBadge";
import { SignalReportStatusBadge } from "@posthog/ui/features/inbox/components/utils/SignalReportStatusBadge";
import { SignalReportSummaryMarkdown } from "@posthog/ui/features/inbox/components/utils/SignalReportSummaryMarkdown";
import { hasKnownSourceProduct } from "@posthog/ui/features/inbox/components/utils/source-product-icons";
import { useInboxReportDetailPrefetch } from "@posthog/ui/features/inbox/hooks/useInboxReportDetailPrefetch";
import { useInboxReportArtefacts } from "@posthog/ui/features/inbox/hooks/useInboxReports";
import { Button as UiButton } from "@posthog/ui/primitives/Button";
import { Flex, Text } from "@radix-ui/themes";
import { Link, useNavigate } from "@tanstack/react-router";
import type { MouseEvent } from "react";

interface ReportCardProps {
  report: SignalReport;
  isSelected?: boolean;
  onRowClick?: (event: MouseEvent) => void;
  onDismiss: () => void;
  dismissDisabledReason?: string | null;
  isDismissPending?: boolean;
}

export function ReportCard({
  report,
  isSelected = false,
  onRowClick,
  onDismiss,
  dismissDisabledReason = null,
  isDismissPending = false,
}: ReportCardProps) {
  const detailRoute = {
    to: "/code/inbox/reports/$reportId" as const,
    params: { reportId: report.id },
  };
  const { prefetch, pointerHandlers } = useInboxReportDetailPrefetch(
    report,
    detailRoute,
  );
  const navigate = useNavigate();
  const { data: artefactsResp } = useInboxReportArtefacts(report.id, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const repoSlug = extractRepoSelectionRepository(artefactsResp?.results);
  const hasSource = hasKnownSourceProduct(report.source_products);
  const updatedAtRaw = report.updated_at ?? report.created_at;
  const updatedAtDate = updatedAtRaw ? new Date(updatedAtRaw) : null;
  const updatedAtLabel =
    updatedAtDate && !Number.isNaN(updatedAtDate.getTime())
      ? updatedAtDate.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })
      : null;
  const isReady = report.status === "ready";
  const conventionalTitle = parseConventionalCommitTitle(report.title);
  const cardTitle = displayConventionalCommitTitle(
    report.title,
    "Untitled report",
  );

  const openDetail = () => {
    prefetch();
    navigate(detailRoute);
  };

  const hasMetadata =
    !!repoSlug ||
    hasSource ||
    !isReady ||
    report.actionability != null ||
    report.is_suggested_reviewer === true;

  return (
    <div
      className={cn(
        "group flex w-full items-stretch gap-3 rounded-(--radius-2) border border-(--gray-6) border-dashed bg-(--color-panel-solid) px-4 py-3.5 transition duration-150 hover:border-(--gray-7) hover:bg-(--gray-2) hover:shadow-sm",
        isSelected &&
          "border-(--accent-8) bg-(--accent-2) ring-(--accent-8) ring-2 ring-inset",
      )}
      {...pointerHandlers}
    >
      <Link
        {...detailRoute}
        preload="intent"
        onClick={(event) => {
          onRowClick?.(event);
          if (event.metaKey || event.ctrlKey || event.shiftKey) {
            event.preventDefault();
            return;
          }
          prefetch();
        }}
        className="flex min-w-0 flex-1 items-start gap-3 text-left text-inherit no-underline focus-visible:outline-none"
      >
        <PriorityMonogram priority={report.priority} />

        <Flex direction="column" gap="1.5" className="min-w-0 flex-1">
          <Flex align="center" gap="1" wrap="wrap" className="min-w-0">
            {conventionalTitle && (
              <ConventionalCommitScopeTag
                type={conventionalTitle.type}
                scope={conventionalTitle.scope}
                compact
              />
            )}
            <InboxCardTitle>{cardTitle}</InboxCardTitle>
          </Flex>

          <div
            className={isReady ? "mt-0.5 min-w-0" : "mt-0.5 min-w-0 opacity-80"}
          >
            {(() => {
              const headline = deriveHeadline(report.summary);
              return headline ? (
                <Text className="wrap-break-word line-clamp-2 text-[12.5px] text-gray-10 leading-snug">
                  {headline}
                </Text>
              ) : (
                <SignalReportSummaryMarkdown
                  content={report.summary}
                  fallback="No summary yet – still collecting context."
                  variant="list"
                  pending={!isReady}
                />
              );
            })()}
          </div>

          {hasMetadata ? (
            <Flex align="center" wrap="wrap" className="mt-1.5 min-w-0 gap-2.5">
              <InboxCardSourceMeta
                repoSlug={repoSlug}
                sourceProducts={report.source_products}
                className=""
              />
              {(!isReady || !report.actionability) && (
                <SignalReportStatusBadge status={report.status} />
              )}
              {report.actionability && (
                <SignalReportActionabilityBadge
                  actionability={report.actionability}
                />
              )}
              {report.is_suggested_reviewer && <ForYouBadge />}
            </Flex>
          ) : null}
        </Flex>
      </Link>

      <Flex
        direction="column"
        align="end"
        justify="between"
        className="shrink-0 border-border border-l pl-3"
      >
        {updatedAtLabel && (
          <Text className="shrink-0 text-[12px] text-gray-10 tabular-nums">
            {updatedAtLabel}
          </Text>
        )}

        <Flex align="center" className="my-auto gap-3.5">
          <Flex align="center" className="shrink-0">
            <SuggestedReviewerAvatarStack
              reportId={report.id}
              artefacts={artefactsResp ?? null}
            />
          </Flex>
          <Flex align="center" className="shrink-0 gap-2.5">
            <UiButton
              type="button"
              variant="soft"
              color="gray"
              size="1"
              aria-label="Dismiss this report"
              tooltipContent="Dismiss this report"
              disabled={dismissDisabledReason !== null || isDismissPending}
              disabledReason={dismissDisabledReason}
              loading={isDismissPending}
              onClick={(event) => {
                event.stopPropagation();
                onDismiss();
              }}
            >
              <ThumbsDownIcon size={14} />
            </UiButton>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                openDetail();
              }}
            >
              Review
            </Button>
          </Flex>
        </Flex>

        <Flex
          align="center"
          gap="1"
          className="shrink-0 text-[12px] text-gray-10"
        >
          <LightningIcon size={11} />
          <span className="tabular-nums">
            {report.signal_count} finding
            {report.signal_count !== 1 ? "s" : ""}
          </span>
        </Flex>
      </Flex>
    </div>
  );
}
