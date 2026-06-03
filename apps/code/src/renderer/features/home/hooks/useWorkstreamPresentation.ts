import { useTasks } from "@renderer/features/tasks/hooks/useTasks";
import type { HomeWorkstream } from "@shared/types/home-snapshot";
import type { PrSnapshot } from "@shared/types/pr-snapshot";
import type { SituationId } from "@shared/types/workflow";
import { pickPrimarySituation } from "@shared/types/workflow-classify";
import { useNavigationStore } from "@stores/navigationStore";
import { openUrlInBrowser } from "@utils/browser";
import {
  SITUATION_VISUAL,
  type SituationCss,
  situationCss,
} from "../utils/situationDisplay";
import { type BoundAction, useBoundActions } from "./useBoundActions";
import { useRunWorkstreamAction } from "./useRunWorkstreamAction";

export interface WorkstreamPresentation {
  pr: PrSnapshot | null;
  title: string;
  primarySid: SituationId;
  accent: SituationCss;
  /** PR author login when it's someone else's PR, else null. */
  author: string | null;
  /** Situations to render as chips — primary + the calm `in_review` are omitted. */
  extraSituations: SituationId[];
  primaryBound: BoundAction | null;
  restBound: BoundAction[];
  primaryIsPr: boolean;
  primaryIsTask: boolean;
  showPrInMenu: boolean;
  showTaskInMenu: boolean;
  hasMenu: boolean;
  runAction: (action: BoundAction) => void;
  openTask: () => void;
  openPr: () => void;
}

/**
 * Shared presentation + action derivation for a workstream, so the list row and
 * board card (which differ only in layout) can't drift on what they show or do.
 */
export function useWorkstreamPresentation(
  workstream: HomeWorkstream,
): WorkstreamPresentation {
  const { data: tasks = [] } = useTasks();
  const navigateToTask = useNavigationStore((s) => s.navigateToTask);
  const boundActions = useBoundActions(workstream);
  const run = useRunWorkstreamAction();

  const pr = workstream.pr;
  const headTask = workstream.tasks[0];
  const title =
    pr?.title ?? headTask?.title ?? workstream.branch ?? "Workstream";
  const primarySid = pickPrimarySituation(workstream.situations) ?? "working";
  const accent = situationCss(SITUATION_VISUAL[primarySid].color);
  const author = pr?.author && !pr.isCurrentUserAuthor ? pr.author : null;
  const extraSituations = workstream.situations.filter(
    (s) => s !== primarySid && s !== "in_review",
  );

  const primaryBound = boundActions[0] ?? null;
  const restBound = primaryBound ? boundActions.slice(1) : [];

  const primaryIsPr = !primaryBound && !!workstream.prUrl;
  const primaryIsTask = !primaryBound && !workstream.prUrl && !!headTask;
  const showPrInMenu = !!workstream.prUrl && !primaryIsPr;
  const showTaskInMenu = !!headTask && !primaryIsTask;
  const hasMenu = restBound.length > 0 || showPrInMenu || showTaskInMenu;

  return {
    pr,
    title,
    primarySid,
    accent,
    author,
    extraSituations,
    primaryBound,
    restBound,
    primaryIsPr,
    primaryIsTask,
    showPrInMenu,
    showTaskInMenu,
    hasMenu,
    runAction: (action) => run(action, workstream),
    openTask: () => {
      if (!headTask) return;
      const task = tasks.find((t) => t.id === headTask.id);
      if (task) navigateToTask(task);
    },
    openPr: () => {
      if (workstream.prUrl) void openUrlInBrowser(workstream.prUrl);
    },
  };
}
