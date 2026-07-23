import { isTerminalStatus } from "@posthog/shared/domain-types";
import { useArchivedTaskIds } from "@posthog/ui/features/archive/useArchivedTaskIds";
import { useTaskSummaries } from "@posthog/ui/features/tasks/useTasks";
import { useEffect, useMemo } from "react";
import {
  type LoopBuilderSession,
  useLoopBuilderSessionStore,
} from "../loopBuilderSessionStore";

// A fresh task can briefly report no run (or a stale summary via
// keepPreviousData) before the cloud run registers; don't treat that as ended.
const FRESH_SESSION_GRACE_MS = 60_000;

/**
 * The recorded builder sessions whose cloud run is still alive. Sessions whose
 * sandbox has shut down (run completed, failed, cancelled, or task archived or
 * deleted) are pruned from the persisted store as their status comes in, so the
 * "in progress" list never offers a resume into a dead session.
 */
export function useLoopBuilderSessions(): LoopBuilderSession[] {
  const sessions = useLoopBuilderSessionStore((state) => state.sessions);
  const archivedTaskIds = useArchivedTaskIds();
  const taskIds = useMemo(
    () => sessions.map((session) => session.taskId),
    [sessions],
  );
  const {
    data: summaries,
    isSuccess,
    isPlaceholderData,
  } = useTaskSummaries(taskIds);

  const liveTaskIds = useMemo(() => {
    if (!isSuccess || isPlaceholderData) return null;
    const live = new Set<string>();
    for (const summary of summaries ?? []) {
      const run = summary.latest_run;
      if (run?.environment === "cloud" && !isTerminalStatus(run.status)) {
        live.add(summary.id);
      }
    }
    return live;
  }, [isSuccess, isPlaceholderData, summaries]);

  useEffect(() => {
    if (!liveTaskIds) return;
    const store = useLoopBuilderSessionStore.getState();
    for (const session of store.sessions) {
      const dead =
        !liveTaskIds.has(session.taskId) &&
        Date.now() - session.startedAt >= FRESH_SESSION_GRACE_MS;
      if (dead || archivedTaskIds.has(session.taskId)) {
        store.removeSession(session.taskId);
      }
    }
  }, [liveTaskIds, archivedTaskIds]);

  return useMemo(
    () =>
      sessions.filter((session) => {
        if (archivedTaskIds.has(session.taskId)) return false;
        if (!liveTaskIds) return true;
        if (liveTaskIds.has(session.taskId)) return true;
        return Date.now() - session.startedAt < FRESH_SESSION_GRACE_MS;
      }),
    [sessions, archivedTaskIds, liveTaskIds],
  );
}
