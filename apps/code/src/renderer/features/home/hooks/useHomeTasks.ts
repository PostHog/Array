import { useArchivedTaskIds } from "@features/archive/hooks/useArchivedTaskIds";
import { useSessions } from "@features/sessions/stores/sessionStore";
import { usePinnedTasks } from "@features/sidebar/hooks/usePinnedTasks";
import {
  type TaskData,
  toTaskData,
} from "@features/sidebar/hooks/useSidebarData";
import { useTaskViewed } from "@features/sidebar/hooks/useTaskViewed";
import { useSidebarStore } from "@features/sidebar/stores/sidebarStore";
import { useSuspendedTaskIds } from "@features/suspension/hooks/useSuspendedTaskIds";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { useWorkspaces } from "@features/workspace/hooks/useWorkspace";
import { useMemo } from "react";

export interface HomeTasks {
  pinnedTasks: TaskData[];
  flatTasks: TaskData[];
  isLoading: boolean;
}

const byActivity = (a: TaskData, b: TaskData) =>
  b.lastActivityAt - a.lastActivityAt;

// Home aggregates ALL of the user's tasks, not the sidebar's workspace-scoped
// slice: it sources the full task list (createdBy = me) and reuses the sidebar's
// Task → TaskData mapping, so cloud tasks and tasks without a checkout surface.
export function useHomeTasks(): HomeTasks {
  const showInternal = useSidebarStore((s) => s.showInternal);
  const { data: tasks = [], isLoading } = useTasks({ showInternal });
  const { data: workspaces, isFetched: workspacesFetched } = useWorkspaces();
  const sessions = useSessions();
  const { timestamps } = useTaskViewed();
  const { pinnedTaskIds } = usePinnedTasks();
  const suspendedTaskIds = useSuspendedTaskIds();
  const archivedTaskIds = useArchivedTaskIds();

  const sessionByTaskId = useMemo(() => {
    const map = new Map<string, (typeof sessions)[string]>();
    for (const session of Object.values(sessions)) {
      if (session.taskId) map.set(session.taskId, session);
    }
    return map;
  }, [sessions]);

  const taskData = useMemo(
    () =>
      tasks
        .filter((task) => !archivedTaskIds.has(task.id))
        .map((task) =>
          toTaskData(task, {
            session: sessionByTaskId.get(task.id),
            workspace: workspaces?.[task.id],
            taskTimestamps: timestamps[task.id],
            isPinned: pinnedTaskIds.has(task.id),
            isSuspended: suspendedTaskIds.has(task.id),
            isSlackOrigin: false,
          }),
        ),
    [
      tasks,
      archivedTaskIds,
      sessionByTaskId,
      workspaces,
      timestamps,
      pinnedTaskIds,
      suspendedTaskIds,
    ],
  );

  const pinnedTasks = useMemo(
    () => taskData.filter((t) => t.isPinned).sort(byActivity),
    [taskData],
  );
  const flatTasks = useMemo(
    () => taskData.filter((t) => !t.isPinned).sort(byActivity),
    [taskData],
  );

  return {
    pinnedTasks,
    flatTasks,
    isLoading: isLoading || !workspacesFetched,
  };
}
