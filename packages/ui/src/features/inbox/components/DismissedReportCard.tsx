import {
  ArrowCounterClockwiseIcon,
  LightningIcon,
} from "@phosphor-icons/react";
import {
  deriveHeadline,
  displayConventionalCommitTitle,
  parseConventionalCommitTitle,
} from "@posthog/core/inbox/reportPresentation";
import { cn } from "@posthog/quill";
import type { SignalReport } from "@posthog/shared/types";
import { ConventionalCommitScopeTag } from "@posthog/ui/features/inbox/components/ConventionalCommitScopeTag";
import { InboxCardSourceMeta } from "@posthog/ui/features/inbox/components/InboxCardSourceMeta";
import { InboxCardTitle } from "@posthog/ui/features/inbox/components/InboxCardTitle";
import { PriorityMonogram } from "@posthog/ui/features/inbox/components/PriorityMonogram";
import { hasKnownSourceProduct } from "@posthog/ui/features/inbox/components/utils/source-product-icons";
import { Button as UiButton } from "@posthog/ui/primitives/Button";
import { Flex, Text } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";

interface DismissedReportCardProps {
  report: SignalReport;
  onRestore: () => void;
  isRestorePending: boolean;
}

/**
 * Card for the Dismissed tab. Links into the read-only dismissed detail view;
 * the Restore button (right column) stops propagation so it doesn't navigate.
 */
export function DismissedReportCard({
  report,
  onRestore,
  isRestorePending,
}: DismissedReportCardProps) {
  const hasSource = hasKnownSourceProduct(report.source_products);
  const dismissedAtRaw = report.updated_at ?? report.created_at;
  const dismissedAtDate = dismissedAtRaw ? new Date(dismissedAtRaw) : null;
  const dismissedAtLabel =
    dismissedAtDate && !Number.isNaN(dismissedAtDate.getTime())
      ? dismissedAtDate.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })
      : null;
  const conventionalTitle = parseConventionalCommitTitle(report.title);
  const cardTitle = displayConventionalCommitTitle(
    report.title,
    "Untitled report",
  );
  const headline = deriveHeadline(report.summary);

  return (
    <div
      className={cn(
        "group flex w-full items-stretch gap-3 rounded-(--radius-2) border border-(--gray-6) border-dashed bg-(--color-panel-solid) px-4 py-3.5 opacity-90 transition duration-150 hover:border-(--gray-7) hover:bg-(--gray-2)",
      )}
    >
      <Link
        to="/code/inbox/dismissed/$reportId"
        params={{ reportId: report.id }}
        preload="intent"
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

          {headline && (
            <Text className="wrap-break-word mt-0.5 line-clamp-2 text-[12.5px] text-gray-10 leading-snug">
              {headline}
            </Text>
          )}

          {(!!hasSource || dismissedAtLabel) && (
            <Flex align="center" wrap="wrap" className="mt-1.5 min-w-0 gap-2.5">
              <InboxCardSourceMeta
                repoSlug={null}
                sourceProducts={report.source_products}
                className=""
              />
              {dismissedAtLabel && (
                <Text className="text-[12px] text-gray-10">
                  Dismissed {dismissedAtLabel}
                </Text>
              )}
            </Flex>
          )}
        </Flex>
      </Link>

      <Flex
        direction="column"
        align="end"
        justify="between"
        className="shrink-0 border-border border-l pl-3"
      >
        <UiButton
          type="button"
          variant="soft"
          color="gray"
          size="1"
          aria-label="Restore this report to the inbox"
          tooltipContent="Restore to inbox"
          loading={isRestorePending}
          disabled={isRestorePending}
          onClick={(event) => {
            event.stopPropagation();
            onRestore();
          }}
        >
          <ArrowCounterClockwiseIcon size={14} />
          Restore
        </UiButton>

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
