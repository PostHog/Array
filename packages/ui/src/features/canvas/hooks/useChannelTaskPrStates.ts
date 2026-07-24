import { useHostTRPC } from "@posthog/host-router/react";
import type { Task } from "@posthog/shared/domain-types";
import type { SidebarPrState } from "@posthog/ui/features/sidebar/useTaskPrStatus";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

export function useChannelTaskPrStates(
  tasks: Task[],
): Map<string, SidebarPrState> {
  const trpc = useHostTRPC();
  const results = useQueries({
    queries: tasks.map((task) => {
      const prUrl =
        typeof task.latest_run?.output?.pr_url === "string"
          ? task.latest_run.output.pr_url
          : null;
      return trpc.workspace.getTaskPrStatus.queryOptions(
        { taskId: task.id, cloudPrUrl: prUrl },
        { staleTime: 60_000 },
      );
    }),
  });
  return useMemo(
    () =>
      new Map(
        tasks.map((task, index) => [
          task.id,
          results[index]?.data?.prState ?? null,
        ]),
      ),
    [results, tasks],
  );
}
