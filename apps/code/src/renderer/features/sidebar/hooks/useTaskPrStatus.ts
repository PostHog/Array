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

export function useTaskPrStatus(task: TaskData): TaskPrStatus {
  const trpc = useTRPC();

  const { data } = useQuery(
    trpc.workspace.getTaskPrStatus.queryOptions(
      { taskId: task.id, cloudPrUrl: task.cloudPrUrl },
      { staleTime: SIDEBAR_STALE_TIME },
    ),
  );

  if (!data || (!data.prState && !data.hasDiff)) return EMPTY;
  return data;
}
