import type { PrSnapshot } from "@posthog/core/home/prSnapshot";
import type { HomeSnapshot, HomeWorkstream } from "@posthog/core/home/schemas";
import type { SituationId } from "@posthog/core/workflow/schemas";
import { useArchiveTask } from "@posthog/ui/features/archive/useArchiveTask";
import {
  type BoundAction,
  useBoundActions,
} from "@posthog/ui/features/home/hooks/useBoundActions";
import { homeKeys } from "@posthog/ui/features/home/hooks/useHomeSnapshot";
import { useRunWorkstreamAction } from "@posthog/ui/features/home/hooks/useRunWorkstreamAction";
import { useQuickActionStore } from "@posthog/ui/features/home/stores/quickActionStore";
import {
  SITUATION_VISUAL,
  type SituationCss,
  situationCss,
} from "@posthog/ui/features/home/utils/situationDisplay";
import { useTasks } from "@posthog/ui/features/tasks/useTasks";
import { toast } from "@posthog/ui/primitives/toast";
import { openTask } from "@posthog/ui/router/useOpenTask";
import { logger } from "@posthog/ui/shell/logger";
import { openUrlInBrowser } from "@posthog/ui/utils/browser";
import { useQueryClient } from "@tanstack/react-query";

const log = logger.scope("workstream-archive");

export interface WorkstreamPresentation {
  pr: PrSnapshot | null;
  title: string;
  primarySid: SituationId;
  accent: SituationCss;
  /** PR author login when it's someone else's PR, else null. */
  author: string | null;
  /** Situations to render as chips – primary + the calm `in_review` are omitted. */
  extraSituations: SituationId[];
  generating: boolean;
  /** A task in this workstream is blocked awaiting a permission response. */
  needsPermission: boolean;
  /** Distinct quick-action labels that have been run against this workstream, newest first. */
  quickActions: string[];
  primaryBound: BoundAction | null;
  restBound: BoundAction[];
  primaryIsPr: boolean;
  primaryIsTask: boolean;
  showPrInMenu: boolean;
  showTaskInMenu: boolean;
  /** Whether the workstream has a task that can be archived from the overflow menu. */
  canArchive: boolean;
  hasMenu: boolean;
  runAction: (action: BoundAction) => void;
  /** True while a quick action is starting a task; disable the row's action controls. */
  isRunningAction: boolean;
  openTask: () => void;
  openPr: () => void;
  /** Archive the workstream's head task and drop it from the Home snapshot. */
  archive: () => void;
}

/**
 * Shared presentation + action derivation for a workstream, so the list row and
 * board card (which differ only in layout) can't drift on what they show or do.
 */
export function useWorkstreamPresentation(
  workstream: HomeWorkstream,
): WorkstreamPresentation {
  const { data: tasks = [] } = useTasks();
  const boundActions = useBoundActions(workstream);
  const { run } = useRunWorkstreamAction();
  const { archiveTask } = useArchiveTask();
  const queryClient = useQueryClient();
  const isRunningAction = useQuickActionStore(
    (s) => !!s.inFlight[workstream.id],
  );

  const pr = workstream.pr;
  const headTask = workstream.tasks[0];
  const title =
    pr?.title ?? headTask?.title ?? workstream.branch ?? "Workstream";
  const primarySid = workstream.primarySituation ?? "working";
  const accent = situationCss(SITUATION_VISUAL[primarySid].color);
  const author = pr?.author && !pr.isCurrentUserAuthor ? pr.author : null;
  const extraSituations = workstream.situations.filter(
    (s) => s !== primarySid && s !== "in_review",
  );
  const generating = workstream.tasks.some((t) => t.isGenerating);
  const needsPermission = workstream.tasks.some((t) => t.needsPermission);
  const quickActions = [
    ...new Set(
      workstream.tasks
        .map((t) => t.quickAction)
        .filter((label): label is string => !!label),
    ),
  ];

  const primaryBound = boundActions[0] ?? null;
  const restBound = primaryBound ? boundActions.slice(1) : [];

  const primaryIsPr = !primaryBound && !!workstream.prUrl;
  const primaryIsTask = !primaryBound && !workstream.prUrl && !!headTask;
  const showPrInMenu = !!workstream.prUrl && !primaryIsPr;
  const showTaskInMenu = !!headTask && !primaryIsTask;
  const canArchive = !!headTask;
  const hasMenu =
    restBound.length > 0 || showPrInMenu || showTaskInMenu || canArchive;

  return {
    pr,
    title,
    primarySid,
    accent,
    author,
    extraSituations,
    generating,
    needsPermission,
    quickActions,
    primaryBound,
    restBound,
    primaryIsPr,
    primaryIsTask,
    showPrInMenu,
    showTaskInMenu,
    canArchive,
    hasMenu,
    runAction: (action) => run(action, workstream),
    isRunningAction,
    openTask: () => {
      if (!headTask) return;
      const task = tasks.find((t) => t.id === headTask.id);
      if (task) void openTask(task);
    },
    openPr: () => {
      if (workstream.prUrl) void openUrlInBrowser(workstream.prUrl);
    },
    archive: () => {
      if (!headTask) return;
      const taskId = headTask.id;
      archiveTask({ taskId })
        .then(() => {
          // The Home snapshot is server-computed and only refreshes on its poll
          // (and, for workstreams, after the code-workstreams worker re-runs),
          // so drop the row optimistically here for immediate feedback.
          queryClient.setQueryData<HomeSnapshot>(homeKeys.snapshot, (old) =>
            old
              ? {
                  ...old,
                  activeAgents: old.activeAgents.filter(
                    (a) => a.taskId !== taskId,
                  ),
                  needsAttention: old.needsAttention.filter(
                    (w) => w.id !== workstream.id,
                  ),
                  inProgress: old.inProgress.filter(
                    (w) => w.id !== workstream.id,
                  ),
                }
              : old,
          );
        })
        .catch((error) => {
          log.error("Failed to archive workstream task", { taskId, error });
          toast.error("Failed to archive task");
        });
    },
  };
}
