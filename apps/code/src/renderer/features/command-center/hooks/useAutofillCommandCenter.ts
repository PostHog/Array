import { useArchivedTaskIds } from "@features/archive/hooks/useArchivedTaskIds";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { useWorkspaces } from "@features/workspace/hooks/useWorkspace";
import type { Task } from "@shared/types";
import { useEffect, useRef } from "react";
import { useCommandCenterStore } from "../stores/commandCenterStore";

const RECENT_WINDOW_MS = 2 * 60 * 60 * 1000;

function getLastActivity(task: Task): number {
  const taskTime = new Date(task.updated_at).getTime();
  const runTime = task.latest_run?.updated_at
    ? new Date(task.latest_run.updated_at).getTime()
    : 0;
  return Math.max(taskTime, runTime);
}

export function useAutofillCommandCenter(): void {
  const { data: tasks = [] } = useTasks();
  const { data: workspaces, isFetched: workspacesFetched } = useWorkspaces();
  const archivedTaskIds = useArchivedTaskIds();

  const cells = useCommandCenterStore((s) => s.cells);
  const autofillCells = useCommandCenterStore((s) => s.autofillCells);

  const hasRunRef = useRef(false);

  useEffect(() => {
    if (hasRunRef.current) return;
    if (!workspacesFetched || !workspaces) return;

    if (!cells.every((id) => id == null)) {
      hasRunRef.current = true;
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

    if (candidates.length > 0) {
      autofillCells(candidates);
    }
    hasRunRef.current = true;
  }, [
    cells,
    workspaces,
    workspacesFetched,
    tasks,
    archivedTaskIds,
    autofillCells,
  ]);
}
