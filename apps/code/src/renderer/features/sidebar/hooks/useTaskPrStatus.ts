import { useTRPC } from "@renderer/trpc";
import { useQuery } from "@tanstack/react-query";
import type { TaskData } from "./useSidebarData";

export type SidebarPrState = "merged" | "open" | "draft" | "closed" | null;

export interface TaskPrStatus {
  prState: SidebarPrState;
  hasDiff: boolean;
}

const SIDEBAR_STALE_TIME = 60_000;
const EMPTY: TaskPrStatus = { prState: null, hasDiff: false };

export function useTaskPrStatus(
  task: Pick<TaskData, "id" | "cloudPrUrl" | "taskRunEnvironment">,
): TaskPrStatus {
  const trpc = useTRPC();

  // Cloud tasks without a PR URL have nothing for the main process to look up
  // — it returns EMPTY immediately. Skip the tRPC roundtrip so a sidebar full
  // of cloud tasks doesn't fire one IPC per task on mount.
  const skipQuery = task.taskRunEnvironment === "cloud" && !task.cloudPrUrl;

  const { data } = useQuery(
    trpc.workspace.getTaskPrStatus.queryOptions(
      { taskId: task.id, cloudPrUrl: task.cloudPrUrl },
      { staleTime: SIDEBAR_STALE_TIME, enabled: !skipQuery },
    ),
  );

  if (!data || (!data.prState && !data.hasDiff)) return EMPTY;
  return data;
}
