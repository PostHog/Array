import {
  CaretDownIcon,
  CaretRightIcon,
  ChatCircleIcon,
  LinkSimpleIcon,
  Plus,
  ThumbsDownIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  buildDetailActionEvent,
  type DetailActionExtra,
} from "@posthog/core/inbox/reportActionEvents";
import {
  canCreateImplementationPr as canCreateImplementationPrRule,
  resolveHeaderImplementationPrUrl,
} from "@posthog/core/inbox/reportActionRules";
import {
  buildSignalFindingMap,
  selectActionabilityJudgment,
  selectPriorityExplanation,
} from "@posthog/core/inbox/reportArtefacts";
import { resolveReportRepository } from "@posthog/core/inbox/reportRepository";
import { partitionSessionProblemSignals } from "@posthog/core/inbox/reportSignals";
import { useHostTRPC } from "@posthog/host-router/react";
import { Kbd } from "@posthog/quill";
import type { InboxReportActionProperties } from "@posthog/shared";
import { buildInboxDeeplink, EXTERNAL_LINKS } from "@posthog/shared";
import type {
  Signal,
  SignalReport,
  SuggestedReviewersArtefact,
  Task,
} from "@posthog/shared/domain-types";
import {
  Box,
  Flex,
  Popover,
  ScrollArea,
  Spinner,
  Text,
  TextArea,
  Tooltip,
} from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useAuthenticatedQuery } from "../../../../hooks/useAuthenticatedQuery";
import { Button } from "../../../../primitives/Button";
import { isMac } from "../../../../utils/platform";
import { useMeQuery } from "../../../auth/useMeQuery";
import { useDetectedCloudRepository } from "../../../repo-files/useDetectedCloudRepository";
import { useCreatePrReport } from "../../hooks/useCreatePrReport";
import { useDiscussReport } from "../../hooks/useDiscussReport";
import {
  useInboxReportArtefacts,
  useInboxReportSignals,
} from "../../hooks/useInboxReports";
import { useReportTasks } from "../../hooks/useReportTasks";
import { ReportImplementationPrLink } from "../utils/ReportImplementationPrLink";
import { SignalReportActionabilityBadge } from "../utils/SignalReportActionabilityBadge";
import { SignalReportPriorityBadge } from "../utils/SignalReportPriorityBadge";
import { SignalReportStatusBadge } from "../utils/SignalReportStatusBadge";
import { SignalReportSummaryMarkdown } from "../utils/SignalReportSummaryMarkdown";
import { ReportTaskLogs } from "./ReportTaskLogs";
import { SignalCard } from "./SignalCard";
import { SuggestedReviewersEditor } from "./SuggestedReviewersEditor";
import type { SignalInteractionAction } from "./signalInteractionContext";

function useReportRepository(reportId: string) {
  return useAuthenticatedQuery<string | null>(
    ["inbox", "report-repository", reportId],
    async (client) => {
      const reportTasks = await client.getSignalReportTasks(reportId);
      return resolveReportRepository(
        reportTasks,
        async (taskId) =>
          (await client.getTask(taskId)) as unknown as Task | null,
      );
    },
    { enabled: !!reportId, staleTime: 30_000 },
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
  explanation,
  onToggleExplanation,
}: {
  label: string;
  value: ReactNode;
  explanation?: string | null;
  onToggleExplanation?: (expanded: boolean) => void;
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
            onClick={() => {
              setExpanded((v) => {
                const next = !v;
                onToggleExplanation?.(next);
                return next;
              });
            }}
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
  onRequestDismissReport: () => void;
  suppressDisabledReason: string | null;
  isDismissMutationPending?: boolean;
  onReportAction?: (
    action: Omit<
      InboxReportActionProperties,
      "rank" | "list_size" | "priority" | "actionability"
    > & {
      priority?: string | null;
      actionability?: string | null;
    },
  ) => void;
  onScroll?: () => void;
}

export function ReportDetailPane({
  report,
  onClose,
  onRequestDismissReport,
  suppressDisabledReason,
  isDismissMutationPending = false,
  onReportAction,
  onScroll,
}: ReportDetailPaneProps) {
  const [discussQuestion, setDiscussQuestion] = useState("");
  const [discussQuestionOpen, setDiscussQuestionOpen] = useState(false);
  const [prFeedback, setPrFeedback] = useState("");
  const [prFeedbackOpen, setPrFeedbackOpen] = useState(false);
  const { data: me } = useMeQuery();

  // ── Report data ─────────────────────────────────────────────────────────
  const artefactsQuery = useInboxReportArtefacts(report.id, {
    enabled: true,
  });
  const allArtefacts = artefactsQuery.data?.results ?? [];

  const reviewerArtefact = useMemo(
    () =>
      allArtefacts.find(
        (a): a is SuggestedReviewersArtefact =>
          a.type === "suggested_reviewers",
      ) ?? null,
    [allArtefacts],
  );

  const signalFindings = useMemo(
    () => buildSignalFindingMap(allArtefacts),
    [allArtefacts],
  );

  const actionabilityJudgment = useMemo(
    () => selectActionabilityJudgment(allArtefacts),
    [allArtefacts],
  );

  const priorityExplanation = useMemo(
    () => selectPriorityExplanation(allArtefacts),
    [allArtefacts],
  );

  const artefactsUnavailableReason = artefactsQuery.data?.unavailableReason;
  void artefactsUnavailableReason; // TODO: wire up unavailable UI

  const signalsQuery = useInboxReportSignals(report.id, {
    enabled: true,
  });
  const allSignals = signalsQuery.data?.signals ?? [];
  const { evidence: sessionProblemSignals, signals } = useMemo(
    () => partitionSessionProblemSignals(allSignals),
    [allSignals],
  );

  // ── Task creation ───────────────────────────────────────────────────────
  const { data: reportRepository } = useReportRepository(report.id);
  const trpc = useHostTRPC();
  const { data: mostRecentRepo } = useQuery(
    trpc.folders.getMostRecentlyAccessedRepository.queryOptions(),
  );
  const detectedFallbackRepo = useDetectedCloudRepository(
    !reportRepository ? mostRecentRepo?.path : null,
  );
  const effectiveCloudRepository = reportRepository ?? detectedFallbackRepo;

  const { data: reportTasksData } = useReportTasks(report.id, report.status);
  const implementationTaskFromHook =
    reportTasksData?.find((t) => t.relationship === "implementation")?.task ??
    null;
  const headerImplementationPrUrl = resolveHeaderImplementationPrUrl(
    report,
    implementationTaskFromHook,
  );

  const canCreateImplementationPr = canCreateImplementationPrRule(report);

  const fireDetailAction = useCallback(
    (
      actionType: InboxReportActionProperties["action_type"],
      extra?: DetailActionExtra,
    ) => {
      onReportAction?.(buildDetailActionEvent(report, actionType, extra));
    },
    [onReportAction, report],
  );

  // Build the signal-card interaction handler used by both signal lists (signals + session-problem evidence).
  const makeSignalInteractionHandler = useCallback(
    (signal: Signal) => (action: SignalInteractionAction) => {
      const signalContext = {
        signal_id: signal.signal_id,
        signal_source_product: signal.source_product,
        signal_source_type: signal.source_type,
      };
      if (action.type === "expand_signal_section") {
        fireDetailAction(action.type, {
          ...signalContext,
          signal_section: action.section,
        });
      } else {
        fireDetailAction(action.type, signalContext);
      }
    },
    [fireDetailAction],
  );

  const { createPrReport, isCreatingPr } = useCreatePrReport({
    reportId: report.id,
    reportTitle: report.title,
    cloudRepository: effectiveCloudRepository,
  });

  const handleCreateImplementationTask = useCallback(
    async (feedback?: string) => {
      if (!canCreateImplementationPr || isCreatingPr) return;
      const trimmedFeedback = feedback?.trim();
      fireDetailAction("create_pr", {
        has_feedback: !!trimmedFeedback,
        feedback_text: trimmedFeedback
          ? trimmedFeedback.slice(0, 500)
          : undefined,
      });
      setPrFeedbackOpen(false);
      await createPrReport(trimmedFeedback);
    },
    [canCreateImplementationPr, isCreatingPr, createPrReport, fireDetailAction],
  );

  const handleCreatePrSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      handleCreateImplementationTask(prFeedback);
    },
    [prFeedback, handleCreateImplementationTask],
  );

  const { discussReport, isDiscussing } = useDiscussReport({
    reportId: report.id,
    reportTitle: report.title,
    cloudRepository: effectiveCloudRepository,
  });

  const handleDiscussReport = useCallback(
    async (question?: string) => {
      const trimmedQuestion = question?.trim();
      fireDetailAction("discuss", {
        has_question: !!trimmedQuestion,
        question_text: trimmedQuestion
          ? trimmedQuestion.slice(0, 500)
          : undefined,
      });
      setDiscussQuestionOpen(false);
      await discussReport(trimmedQuestion);
    },
    [discussReport, fireDetailAction],
  );

  const handleDiscussSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      handleDiscussReport(discussQuestion);
    },
    [discussQuestion, handleDiscussReport],
  );

  // Bind native scroll listener to the Radix ScrollArea viewport (Radix doesn't forward onScroll).
  // The viewport's data-report-id attribute is set from report.id so we both (a) track the
  // current report in the DOM for debugging and (b) give biome's useExhaustiveDependencies
  // a real reactive use of report.id, ensuring the effect re-binds on every report swap.
  const scrollAreaRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!onScroll) return;
    const root = scrollAreaRootRef.current;
    if (!root) return;
    const viewport = root.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (!viewport) return;
    viewport.dataset.reportId = report.id;
    const handler = () => onScroll();
    viewport.addEventListener("scroll", handler, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", handler);
      delete viewport.dataset.reportId;
    };
  }, [onScroll, report.id]);

  useEffect(() => {
    if (!canCreateImplementationPr) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (
        document.querySelector(
          "[data-radix-popper-content-wrapper], [role='dialog'][data-state='open']",
        )
      ) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (
        target?.closest("input, select, textarea, [contenteditable='true']")
      ) {
        return;
      }
      e.preventDefault();
      handleCreateImplementationTask();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canCreateImplementationPr, handleCreateImplementationTask]);

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
        <Flex align="center" gap="2" className="shrink-0">
          <Tooltip content="Copy link to this report">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    buildInboxDeeplink(report.id, report.title, {
                      isDevBuild: import.meta.env.DEV,
                    }),
                  );
                  fireDetailAction("copy_link");
                  toast.success("Link copied");
                } catch {
                  toast.error("Failed to copy link");
                }
              }}
              aria-label="Copy link to this report"
              className="flex h-5 w-5 items-center justify-center rounded text-gray-11 transition-colors hover:bg-gray-3 hover:text-gray-12"
            >
              <LinkSimpleIcon size={14} />
            </button>
          </Tooltip>
          <Button
            size="1"
            variant="soft"
            color="gray"
            className="text-[12px]"
            tooltipContent="This report is not useful to me"
            disabledReason={suppressDisabledReason}
            disabled={
              suppressDisabledReason !== null || isDismissMutationPending
            }
            onClick={() => onRequestDismissReport()}
          >
            {isDismissMutationPending ? (
              <Spinner size="1" />
            ) : (
              <ThumbsDownIcon size={12} />
            )}
            Dismiss
          </Button>
          <Flex align="center" gap="0">
            <Button
              size="1"
              variant="soft"
              className="gap-1 rounded-r-none text-[12px]"
              tooltipContent="Discuss this report in a task with your agent"
              disabled={isDiscussing}
              onClick={() => handleDiscussReport()}
            >
              {isDiscussing ? (
                <Spinner size="1" />
              ) : (
                <ChatCircleIcon size={12} />
              )}
              Discuss
            </Button>
            <Popover.Root
              open={discussQuestionOpen}
              onOpenChange={setDiscussQuestionOpen}
            >
              <Popover.Trigger>
                <Button
                  size="1"
                  variant="soft"
                  className="rounded-l-none border-l border-l-(--gray-5) px-1"
                  aria-label="Ask an optional first question"
                  disabled={isDiscussing}
                >
                  <CaretDownIcon size={12} />
                </Button>
              </Popover.Trigger>
              <Popover.Content
                align="end"
                className="w-[420px] border border-(--gray-6) bg-(--color-panel-solid) p-3 shadow-6"
                side="bottom"
                sideOffset={6}
              >
                <form
                  className="flex flex-col gap-2"
                  onSubmit={handleDiscussSubmit}
                >
                  <TextArea
                    aria-label="Optional first question for Discuss"
                    autoFocus
                    placeholder="Ask about this report..."
                    resize="vertical"
                    rows={5}
                    size="2"
                    value={discussQuestion}
                    onChange={(event) => setDiscussQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        (event.metaKey || event.ctrlKey)
                      ) {
                        event.preventDefault();
                        handleDiscussReport(discussQuestion);
                      }
                    }}
                  />
                  <Flex justify="between" align="center" gap="2">
                    <Text size="1" color="gray">
                      <Kbd>{isMac ? "⌘↵" : "Ctrl+↵"}</Kbd> to send
                    </Text>
                    <Flex gap="2">
                      <Button
                        color="gray"
                        size="1"
                        type="button"
                        variant="soft"
                        onClick={() => setDiscussQuestionOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button size="1" type="submit" variant="soft">
                        Discuss
                      </Button>
                    </Flex>
                  </Flex>
                </form>
              </Popover.Content>
            </Popover.Root>
          </Flex>
          {headerImplementationPrUrl ? (
            <ReportImplementationPrLink
              prUrl={headerImplementationPrUrl}
              size="md"
              onLinkClick={() => fireDetailAction("open_pr")}
            />
          ) : canCreateImplementationPr ? (
            <Flex align="center" gap="0">
              <Tooltip
                content={
                  <Flex align="center" gap="1">
                    Create PR <Kbd>{isMac ? "⌘↵" : "Ctrl+↵"}</Kbd>
                  </Flex>
                }
              >
                <Button
                  size="1"
                  variant="solid"
                  className="gap-1 rounded-r-none text-[12px]"
                  disabled={isCreatingPr}
                  onClick={() => handleCreateImplementationTask()}
                >
                  {isCreatingPr ? <Spinner size="1" /> : <Plus size={12} />}
                  Create PR
                </Button>
              </Tooltip>
              <Popover.Root
                open={prFeedbackOpen}
                onOpenChange={setPrFeedbackOpen}
              >
                <Popover.Trigger>
                  <Button
                    size="1"
                    variant="solid"
                    className="rounded-l-none border-l border-l-(--gray-a5) px-1"
                    aria-label="Add optional feedback for the PR"
                    disabled={isCreatingPr}
                  >
                    <CaretDownIcon size={12} />
                  </Button>
                </Popover.Trigger>
                <Popover.Content
                  align="end"
                  className="w-[420px] border border-(--gray-6) bg-(--color-panel-solid) p-3 shadow-6"
                  side="bottom"
                  sideOffset={6}
                >
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={handleCreatePrSubmit}
                  >
                    <TextArea
                      aria-label="Optional feedback for Create PR"
                      autoFocus
                      placeholder="Add any extra feedback, e.g. answers to questions raised in the report thread..."
                      resize="vertical"
                      rows={5}
                      size="2"
                      value={prFeedback}
                      onChange={(event) => setPrFeedback(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          (event.metaKey || event.ctrlKey)
                        ) {
                          event.preventDefault();
                          handleCreateImplementationTask(prFeedback);
                        }
                      }}
                    />
                    <Flex justify="between" align="center" gap="2">
                      <Text size="1" color="gray">
                        <Kbd>{isMac ? "⌘↵" : "Ctrl+↵"}</Kbd> to create
                      </Text>
                      <Flex gap="2">
                        <Button
                          color="gray"
                          size="1"
                          type="button"
                          variant="soft"
                          onClick={() => setPrFeedbackOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="1"
                          type="submit"
                          variant="solid"
                          disabled={isCreatingPr}
                        >
                          Create PR
                        </Button>
                      </Flex>
                    </Flex>
                  </form>
                </Popover.Content>
              </Popover.Root>
            </Flex>
          ) : null}
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
        ref={scrollAreaRootRef}
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
                  onToggleExplanation={(expanded) => {
                    if (!expanded) return;
                    fireDetailAction("expand_why", { why_field: "priority" });
                  }}
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
                  onToggleExplanation={(expanded) => {
                    if (!expanded) return;
                    fireDetailAction("expand_why", {
                      why_field: "actionability",
                    });
                  }}
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
          {reviewerArtefact && (
            <SuggestedReviewersEditor
              reportId={report.id}
              artefact={reviewerArtefact}
              meUuid={me?.uuid}
              fireAction={fireDetailAction}
            />
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
                    onInteraction={makeSignalInteractionHandler(signal)}
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
                    onInteraction={makeSignalInteractionHandler(signal)}
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
        onSectionExpand={(section) =>
          fireDetailAction("expand_task_section", { task_section: section })
        }
      />
    </>
  );
}
