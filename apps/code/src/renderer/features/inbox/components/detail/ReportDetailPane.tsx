import { Badge } from "@components/ui/Badge";
import {
  useInboxReportArtefacts,
  useInboxReportSignals,
} from "@features/inbox/hooks/useInboxReports";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import { useDetectedCloudRepository } from "@hooks/useDetectedCloudRepository";
import { useMeQuery } from "@hooks/useMeQuery";
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  EyeIcon,
  LinkSimpleIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Box, Flex, ScrollArea, Text, Tooltip } from "@radix-ui/themes";
import { useTRPC } from "@renderer/trpc";
import { EXTERNAL_LINKS } from "@renderer/utils/links";
import { getDeeplinkProtocol } from "@shared/deeplink";
import type {
  ActionabilityJudgmentArtefact,
  ActionabilityJudgmentContent,
  PriorityJudgmentArtefact,
  SignalFindingArtefact,
  SignalReport,
  SignalReportTask,
  SuggestedReviewer,
  SuggestedReviewersArtefact,
  Task,
} from "@shared/types";
import { useNavigationStore } from "@stores/navigationStore";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { SignalReportActionabilityBadge } from "../utils/SignalReportActionabilityBadge";
import { SignalReportPriorityBadge } from "../utils/SignalReportPriorityBadge";
import { SignalReportStatusBadge } from "../utils/SignalReportStatusBadge";
import { SignalReportSummaryMarkdown } from "../utils/SignalReportSummaryMarkdown";
import { ReportTaskLogs } from "./ReportTaskLogs";
import { SignalCard } from "./SignalCard";

function isSuggestedReviewerRowMe(
  reviewer: SuggestedReviewer,
  meUuid: string | undefined,
): boolean {
  return !!reviewer.user?.uuid && !!meUuid && meUuid === reviewer.user.uuid;
}

const REPOSITORY_SOURCE_RELATIONSHIPS: SignalReportTask["relationship"][] = [
  "repo_selection",
  "research",
  "implementation",
];

function useReportRepository(reportId: string) {
  return useAuthenticatedQuery<string | null>(
    ["inbox", "report-repository", reportId],
    async (client) => {
      const reportTasks = await client.getSignalReportTasks(reportId);

      for (const relationship of REPOSITORY_SOURCE_RELATIONSHIPS) {
        const reportTask = reportTasks.find(
          (task) => task.relationship === relationship,
        );
        if (!reportTask) continue;

        const task = (await client.getTask(
          reportTask.task_id,
        )) as unknown as Task | null;
        if (task?.repository) {
          return task.repository.toLowerCase();
        }
      }

      return null;
    },
    { enabled: !!reportId, staleTime: 30_000 },
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
  explanation,
}: {
  label: string;
  value: ReactNode;
  explanation?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasExplanation = !!explanation;

  return (
    <Box>
      <Flex align="center" gap="2">
        <Text className="w-[90px] shrink-0 text-(--gray-10) text-[13px]">
          {label}
        </Text>
        {value}
        {hasExplanation && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[13px] text-gray-9 hover:bg-gray-3 hover:text-gray-11"
          >
            {expanded ? (
              <CaretDownIcon size={12} />
            ) : (
              <CaretRightIcon size={12} />
            )}
            Why?
          </button>
        )}
      </Flex>
      {expanded && explanation && (
        <Text
          color="gray"
          className="mt-1 block text-pretty pl-[90px] text-[13px] leading-relaxed"
        >
          {explanation}
        </Text>
      )}
    </Box>
  );
}

// ── ReportDetailPane ────────────────────────────────────────────────────────

interface ReportDetailPaneProps {
  report: SignalReport;
  onClose: () => void;
}

export function ReportDetailPane({ report, onClose }: ReportDetailPaneProps) {
  const { data: me } = useMeQuery();

  // ── Report data ─────────────────────────────────────────────────────────
  const artefactsQuery = useInboxReportArtefacts(report.id, {
    enabled: true,
  });
  const allArtefacts = artefactsQuery.data?.results ?? [];

  const suggestedReviewers = useMemo(() => {
    const reviewerArtefact = allArtefacts.find(
      (a): a is SuggestedReviewersArtefact => a.type === "suggested_reviewers",
    );
    return reviewerArtefact?.content ?? [];
  }, [allArtefacts]);

  const signalFindings = useMemo(() => {
    const map = new Map<string, SignalFindingArtefact["content"]>();
    for (const a of allArtefacts) {
      if (a.type === "signal_finding") {
        const finding = a as SignalFindingArtefact;
        map.set(finding.content.signal_id, finding.content);
      }
    }
    return map;
  }, [allArtefacts]);

  const actionabilityJudgment =
    useMemo((): ActionabilityJudgmentContent | null => {
      for (const a of allArtefacts) {
        if (a.type === "actionability_judgment") {
          return (a as ActionabilityJudgmentArtefact).content;
        }
      }
      return null;
    }, [allArtefacts]);

  const priorityExplanation = useMemo((): string | null => {
    for (const a of allArtefacts) {
      if (a.type === "priority_judgment") {
        return (a as PriorityJudgmentArtefact).content.explanation || null;
      }
    }
    return null;
  }, [allArtefacts]);

  const artefactsUnavailableReason = artefactsQuery.data?.unavailableReason;
  void artefactsUnavailableReason; // TODO: wire up unavailable UI

  const signalsQuery = useInboxReportSignals(report.id, {
    enabled: true,
  });
  const allSignals = signalsQuery.data?.signals ?? [];
  const sessionProblemSignals = allSignals.filter(
    (s) =>
      s.source_product === "session_replay" &&
      s.source_type === "session_problem",
  );
  const signals = allSignals.filter(
    (s) =>
      !(
        s.source_product === "session_replay" &&
        s.source_type === "session_problem"
      ),
  );

  // ── Task creation ───────────────────────────────────────────────────────
  const { navigateToTaskInput } = useNavigationStore();
  const { data: reportRepository } = useReportRepository(report.id);
  const trpcReact = useTRPC();
  const { data: mostRecentRepo } = useQuery(
    trpcReact.folders.getMostRecentlyAccessedRepository.queryOptions(),
  );
  const detectedFallbackRepo = useDetectedCloudRepository(
    !reportRepository ? mostRecentRepo?.path : null,
  );
  const effectiveCloudRepository = reportRepository ?? detectedFallbackRepo;

  /** True when the report is waiting on user input before implementation can proceed.
   * Covers the `pending_input` status and the `ready + requires_human_input` combination
   * (the actionability badge shows "Needs input" in that case). */
  const isAwaitingInput =
    report.status === "pending_input" ||
    (report.status === "ready" &&
      report.actionability === "requires_human_input");

  /** Matches server autostart rules: ready + immediately actionable + not already fixed.
   * When the report is awaiting input we also surface the action so the user can provide it. */
  const canCreateImplementationPr =
    isAwaitingInput ||
    (report.status === "ready" &&
      report.actionability === "immediately_actionable" &&
      report.already_addressed !== true);

  const handleCreateImplementationTask = useCallback(() => {
    if (!canCreateImplementationPr) return;
    navigateToTaskInput({
      initialPrompt: `Act on this signal report. Investigate the root cause, implement the fix, and open a PR if appropriate.\n\n${report.summary ?? ""}`,
      initialCloudRepository: effectiveCloudRepository ?? undefined,
      reportAssociation: {
        reportId: report.id,
        title: report.title ?? "Untitled signal",
      },
    });
  }, [
    canCreateImplementationPr,
    navigateToTaskInput,
    effectiveCloudRepository,
    report,
  ]);

  return (
    <>
      {/* ── Header bar ──────────────────────────────────────────── */}
      <Flex
        align="center"
        justify="between"
        gap="2"
        py="2"
        className="shrink-0 border-b border-b-(--gray-5) @2xl:px-6 @3xl:px-8 @4xl:px-10 @5xl:px-12 @lg:px-4 @md:px-3 @xl:px-5 px-2"
      >
        <Flex align="center" gap="2" className="min-w-0">
          <SignalReportStatusBadge status={report.status} />
          <Text
            className={`block min-w-0 text-balance break-words text-base ${report.status === "ready" ? "font-bold" : "font-medium"}`}
          >
            {report.title ?? "Untitled signal"}
          </Text>
        </Flex>
        <Flex align="center" gap="1" className="shrink-0">
          <Tooltip content="Copy link to this report">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `${getDeeplinkProtocol(import.meta.env.DEV)}://inbox/${report.id}`,
                  );
                  toast.success("Link copied");
                } catch {
                  toast.error("Failed to copy link");
                }
              }}
              aria-label="Copy link to this report"
              className="rounded p-0.5 text-gray-11 hover:bg-gray-3 hover:text-gray-12"
            >
              <LinkSimpleIcon size={14} />
            </button>
          </Tooltip>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report detail"
            className="rounded p-0.5 text-gray-11 hover:bg-gray-3 hover:text-gray-12"
          >
            <XIcon size={14} />
          </button>
        </Flex>
      </Flex>

      {/* ── Scrollable detail area ──────────────────────────────── */}
      <ScrollArea
        type="auto"
        scrollbars="vertical"
        className="scroll-area-constrain-width flex-1"
      >
        <Flex
          direction="column"
          gap="2"
          className="min-w-0 @2xl:px-6 @3xl:px-8 @4xl:px-10 @5xl:px-12 @lg:px-4 @md:px-3 @xl:px-5 px-2 @2xl:pt-3 @3xl:pt-4 @4xl:pt-5 @5xl:pt-6 @lg:pt-2 @md:pt-1.5 @xl:pt-2.5 pt-1 @2xl:pb-6 @3xl:pb-8 @4xl:pb-10 @5xl:pb-12 @lg:pb-4 @md:pb-3 @xl:pb-5 pb-2"
        >
          {/* ── Failed report error ──────────────────────────── */}
          {report.status === "failed" && (
            <Flex
              align="start"
              gap="2"
              px="2"
              py="2"
              className="select-none rounded-sm border border-red-6 bg-red-2"
            >
              <WarningIcon
                size={14}
                weight="fill"
                className="mt-0.5 shrink-0 text-(--red-9)"
              />
              <Flex direction="column" className="min-w-0 flex-1">
                <Text className="font-medium text-(--red-11) text-[12px]">
                  Report processing failed
                </Text>
                <Text className="text-(--red-9) text-[11px]">
                  There was an issue processing this report. This has been
                  reported to our team.
                  <br />
                  To get in touch with the team directly,{" "}
                  <a
                    href={EXTERNAL_LINKS.discord}
                    target="_blank"
                    rel="noreferrer"
                    className="text-(--red-9) underline hover:text-(--red-11)"
                  >
                    join our Discord
                  </a>
                  .
                </Text>
              </Flex>
            </Flex>
          )}

          {/* ── Description ─────────────────────────────────────── */}
          {report.status !== "ready" ? (
            <Tooltip content="This is a preliminary description. A full researched summary will replace it when the research agent completes its work.">
              <div className="cursor-help">
                <SignalReportSummaryMarkdown
                  content={report.summary}
                  fallback="No summary available."
                  variant="detail"
                  pending
                />
              </div>
            </Tooltip>
          ) : (
            <SignalReportSummaryMarkdown
              content={report.summary}
              fallback="No summary available."
              variant="detail"
            />
          )}

          {/* ── Priority / Actionability ──────────────────────── */}
          {(report.priority || report.actionability) && (
            <Flex
              direction="column"
              gap="1"
              py="2"
              className="border-t border-t-(--gray-5)"
            >
              {report.priority && (
                <DetailRow
                  label="Priority"
                  value={
                    <SignalReportPriorityBadge priority={report.priority} />
                  }
                  explanation={priorityExplanation}
                />
              )}
              {report.actionability && (
                <DetailRow
                  label="Actionability"
                  value={
                    <SignalReportActionabilityBadge
                      actionability={report.actionability}
                    />
                  }
                  explanation={actionabilityJudgment?.explanation}
                />
              )}
            </Flex>
          )}

          {/* ── Already-addressed warning ─────────────────────── */}
          {(report.already_addressed ??
            actionabilityJudgment?.already_addressed) && (
            <Flex
              align="center"
              gap="2"
              px="2"
              py="1"
              className="rounded border border-amber-6 bg-amber-2"
            >
              <WarningIcon
                size={14}
                weight="fill"
                className="shrink-0 text-(--amber-9)"
              />
              <Text className="text-(--amber-11) text-[12px]">
                This issue may already be addressed in recent code changes.
              </Text>
            </Flex>
          )}

          {/* ── Suggested reviewers ─────────────────────────────── */}
          {suggestedReviewers.length > 0 && (
            <Box>
              <Text className="block font-medium text-sm" mb="2">
                Suggested reviewers
              </Text>
              <Flex direction="column" gap="1">
                {suggestedReviewers.map((reviewer) => {
                  const isMe = isSuggestedReviewerRowMe(reviewer, me?.uuid);
                  return (
                    <Flex
                      key={reviewer.github_login}
                      align="center"
                      gap="2"
                      wrap="wrap"
                    >
                      <img
                        src={`https://github.com/${reviewer.github_login}.png?size=28`}
                        alt=""
                        className="github-avatar h-[18px] w-[18px] shrink-0 rounded-full"
                        onLoad={(e) => e.currentTarget.classList.add("loaded")}
                      />
                      <Text className="text-[12px]">
                        {reviewer.user?.first_name ??
                          reviewer.github_name ??
                          reviewer.github_login}
                      </Text>
                      {isMe && (
                        <Tooltip content="You are a suggested reviewer">
                          <Badge color="amber" className="!py-1 !text-[8px]">
                            <EyeIcon
                              size={8}
                              weight="bold"
                              className="shrink-0"
                            />
                          </Badge>
                        </Tooltip>
                      )}
                      <a
                        href={`https://github.com/${reviewer.github_login}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-[11px] text-gray-9 hover:text-gray-11"
                      >
                        @{reviewer.github_login}
                        <ArrowSquareOutIcon size={10} />
                      </a>
                      {reviewer.relevant_commits.length > 0 && (
                        <span className="text-[11px] text-gray-9">
                          {reviewer.relevant_commits.map((commit, i) => (
                            <span key={commit.sha}>
                              {i > 0 && ", "}
                              <Tooltip content={commit.reason || undefined}>
                                <a
                                  href={commit.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-mono text-gray-9 hover:text-gray-11"
                                >
                                  {commit.sha.slice(0, 7)}
                                </a>
                              </Tooltip>
                            </span>
                          ))}
                        </span>
                      )}
                    </Flex>
                  );
                })}
              </Flex>
            </Box>
          )}

          {/* ── Signals ─────────────────────────────────────────── */}
          {signals.length > 0 && (
            <Box mt="4">
              <Text className="block font-medium text-sm" mb="2">
                Signals ({signals.length})
              </Text>
              <Flex direction="column" gap="2">
                {signals.map((signal) => (
                  <SignalCard
                    key={signal.signal_id}
                    signal={signal}
                    finding={signalFindings.get(signal.signal_id)}
                  />
                ))}
              </Flex>
            </Box>
          )}
          {signalsQuery.isLoading && (
            <Text color="gray" className="block text-[12px]">
              Loading signals...
            </Text>
          )}

          {/* ── Session problem evidence ─────────────────────────── */}
          {sessionProblemSignals.length > 0 && (
            <Box>
              <Text className="block font-medium text-[13px]" mb="2">
                Evidence ({sessionProblemSignals.length})
              </Text>
              <Flex direction="column" gap="2">
                {sessionProblemSignals.map((signal) => (
                  <SignalCard
                    key={signal.signal_id}
                    signal={signal}
                    finding={signalFindings.get(signal.signal_id)}
                  />
                ))}
              </Flex>
            </Box>
          )}
        </Flex>
      </ScrollArea>

      {/* ── Research task logs (bottom preview + overlay) ─────── */}
      <ReportTaskLogs
        key={report.id}
        reportId={report.id}
        reportStatus={report.status}
        isAwaitingInput={isAwaitingInput}
        onCreateImplementationTask={
          canCreateImplementationPr ? handleCreateImplementationTask : undefined
        }
      />
    </>
  );
}
