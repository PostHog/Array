import { Badge } from "@components/ui/Badge";
import { ReportImplementationPrLink } from "@features/inbox/components/utils/ReportImplementationPrLink";
import { SignalReportActionabilityBadge } from "@features/inbox/components/utils/SignalReportActionabilityBadge";
import { SignalReportPriorityBadge } from "@features/inbox/components/utils/SignalReportPriorityBadge";
import { SignalReportStatusBadge } from "@features/inbox/components/utils/SignalReportStatusBadge";
import { SignalReportSummaryMarkdown } from "@features/inbox/components/utils/SignalReportSummaryMarkdown";
import { EyeIcon, LightningIcon } from "@phosphor-icons/react";
import { Flex, Text, Tooltip } from "@radix-ui/themes";
import type { SignalReport } from "@shared/types";
import type { ReactNode } from "react";

interface ReportCardContentProps {
  report: SignalReport;
  /** Show signal count, user count, and date in a meta row below the summary. */
  showMeta?: boolean;
  /** Tighter vertical and horizontal gaps for inbox list rows. */
  compact?: boolean;
  /** Optional badge node rendered before the standard status/priority/actionability badges. */
  prependBadges?: ReactNode;
}

export function ReportCardContent({
  report,
  showMeta = false,
  compact = false,
  prependBadges,
}: ReportCardContentProps) {
  const isReady = report.status === "ready";

  const updatedAtLabel = new Date(report.updated_at).toLocaleDateString(
    undefined,
    { month: "short", day: "numeric" },
  );

  return (
    <Flex
      direction="column"
      gap={compact ? undefined : "1"}
      className={compact ? "gap-0.5" : undefined}
    >
      <Flex align="start" gapX={compact ? "1" : "2"} className="min-w-0">
        <Text className="min-w-0 flex-1 break-words font-medium text-[13px]">
          {report.title ?? "Untitled signal"}
        </Text>
        {!showMeta && (
          <Text color="gray" className="shrink-0 text-[12px]">
            {updatedAtLabel}
          </Text>
        )}
      </Flex>

      <Flex
        align="center"
        justify="between"
        gapX={compact ? "1" : "2"}
        className="h-[21px] w-full min-w-0" // Same height as PR badge, even if there's no PR badge
      >
        <Flex
          align="center"
          gapX={compact ? "1" : "2"}
          wrap="wrap"
          className="min-w-0 flex-1"
        >
          {prependBadges}
          {!isReady && <SignalReportStatusBadge status={report.status} />}
          <SignalReportPriorityBadge priority={report.priority} />
          <SignalReportActionabilityBadge
            actionability={report.actionability}
          />
          {report.is_suggested_reviewer && (
            <Tooltip content="You are a suggested reviewer">
              <Badge
                color="amber"
                className="!leading-none inline-flex items-center justify-center"
              >
                <EyeIcon size={10} weight="bold" className="shrink-0" />
              </Badge>
            </Tooltip>
          )}
        </Flex>
        {report.implementation_pr_url && (
          <ReportImplementationPrLink prUrl={report.implementation_pr_url} />
        )}
      </Flex>

      <div className="min-w-0" style={{ opacity: isReady ? 1 : 0.82 }}>
        <SignalReportSummaryMarkdown
          content={report.summary}
          fallback="No summary yet — still collecting context."
          variant="list"
          pending={!isReady}
        />
      </div>

      {showMeta && (
        <Flex align="center" gapX="3" className="text-[11px] text-gray-9">
          <Flex align="center" gapX="1">
            <LightningIcon size={11} />
            <Text className="text-[11px]">
              {report.signal_count} signal
              {report.signal_count !== 1 ? "s" : ""}
            </Text>
          </Flex>
          <Text className="text-[11px]">{updatedAtLabel}</Text>
        </Flex>
      )}
    </Flex>
  );
}
