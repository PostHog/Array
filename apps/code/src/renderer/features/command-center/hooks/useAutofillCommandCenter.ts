import { useArchivedTaskIds } from "@features/archive/hooks/useArchivedTaskIds";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { useWorkspaces } from "@features/workspace/hooks/useWorkspace";
import type { Task } from "@shared/types";
import { useEffect } from "react";
import { useCommandCenterStore } from "../stores/commandCenterStore";

// Window for "still in the current working session". Tasks last touched
// within this window are eligible to autofill empty cells on first view.
const RECENT_WINDOW_MS = 2 * 60 * 60 * 1000;

function getLastActivity(task: Task): number {
  const taskTime = new Date(task.updated_at).getTime();
  const runTime = task.latest_run?.updated_at
    ? new Date(task.latest_run.updated_at).getTime()
    : 0;
  return Math.max(taskTime, runTime);
}

export function useAutofillCommandCenter(): void {
  const { data: tasks = [], isFetched: tasksFetched } = useTasks();
  const { data: workspaces, isFetched: workspacesFetched } = useWorkspaces();
  const archivedTaskIds = useArchivedTaskIds();

  const cells = useCommandCenterStore((s) => s.cells);
  const hasAutofilled = useCommandCenterStore((s) => s.hasAutofilled);
  const autofillCells = useCommandCenterStore((s) => s.autofillCells);
  const markAutofilled = useCommandCenterStore((s) => s.markAutofilled);

  useEffect(() => {
    if (hasAutofilled) return;
    if (!workspacesFetched || !workspaces) return;
    if (!tasksFetched) return;

    // User already has cells assigned (manual or persisted from a prior session).
    // Treat them as in control and don't autofill in the future.
    if (!cells.every((id) => id == null)) {
      markAutofilled();
      return;
    }

    const cutoff = Date.now() - RECENT_WINDOW_MS;
    const candidates = tasks
      .filter(
        (task) =>
          !archivedTaskIds.has(task.id) &&
          !!workspaces[task.id] &&
          getLastActivity(task) >= cutoff,
      )
      .sort((a, b) => getLastActivity(b) - getLastActivity(a))
      .slice(0, cells.length)
      .map((task) => task.id);

    // Leave the flag false when there are no candidates so a future
    // mount can pick up tasks that become recent later.
    if (candidates.length > 0) {
      autofillCells(candidates);
    }
  }, [
    hasAutofilled,
    cells,
    workspaces,
    workspacesFetched,
    tasks,
    tasksFetched,
    archivedTaskIds,
    autofillCells,
    markAutofilled,
  ]);
}
