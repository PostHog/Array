import { useArchivedTaskIds } from "@features/archive/hooks/useArchivedTaskIds";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { useWorkspaces } from "@features/workspace/hooks/useWorkspace";
import type { Task } from "@shared/types";
import { useEffect } from "react";
import { useCommandCenterStore } from "../stores/commandCenterStore";

// Window for "still in the current working session". Tasks last touched
// within this window are eligible to autofill empty cells when the
// Command Center mounts.
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

  useEffect(() => {
    // Autofill is a one-time convenience to bootstrap an empty grid. Once it
    // has populated the grid (or the user has curated it), the persisted
    // `hasAutofilled` flag stops it from re-topping-up empty cells every time
    // the Command Center remounts — opening a task full-screen and coming back
    // no longer wipes out a deliberately trimmed layout.
    if (hasAutofilled) return;
    if (!workspacesFetched || !workspaces) return;
    if (!tasksFetched) return;

    const emptySlots = cells.filter((id) => id == null).length;
    const assignedIds = new Set(cells.filter((id): id is string => id != null));
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    const candidates = tasks
      .filter(
        (task) =>
          !assignedIds.has(task.id) &&
          !archivedTaskIds.has(task.id) &&
          !!workspaces[task.id] &&
          getLastActivity(task) >= cutoff,
      )
      .sort((a, b) => getLastActivity(b) - getLastActivity(a))
      .slice(0, emptySlots)
      .map((task) => task.id);

    // Hand the candidates to the store, which records the one-time bootstrap
    // — including when the grid is already full and there is nothing to place.
    // With no eligible tasks yet on a partial grid the flag stays unset, so
    // autofill can still bootstrap once recent tasks exist.
    autofillCells(candidates);
  }, [
    cells,
    hasAutofilled,
    workspaces,
    workspacesFetched,
    tasks,
    tasksFetched,
    archivedTaskIds,
    autofillCells,
  ]);
}
