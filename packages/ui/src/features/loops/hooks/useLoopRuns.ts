import { type LoopSchemas, listLoopRuns } from "@posthog/api-client/loops";
import type { Task } from "@posthog/shared/domain-types";
import { getAuthenticatedClient } from "@posthog/ui/features/auth/authClientImperative";
import { AUTH_SCOPED_QUERY_META } from "@posthog/ui/features/auth/useCurrentUser";
import { useQuery } from "@tanstack/react-query";
import { loopsKeys } from "./loopsKeys";
import { useLoopsClient } from "./useLoopsClient";

export const RECENT_RUNS_LIMIT = 10;

export function reconcileLoopRunStatus(
  run: LoopSchemas.LoopRun,
  task: Task,
): LoopSchemas.LoopRun {
  const latestRun = task.latest_run;
  if (run.status !== "in_progress" || !latestRun) return run;
  if (latestRun.status !== "cancelled" && latestRun.status !== "failed") {
    return run;
  }

  return {
    ...run,
    status: latestRun.status,
    completed_at: latestRun.completed_at,
    error_message: latestRun.error_message,
  };
}

/** The most recent runs for a loop, polled so the detail view stays live. */
export function useLoopRuns(loopId: string | undefined) {
  const loopsClient = useLoopsClient();

  return useQuery<LoopSchemas.LoopRunPage, Error, LoopSchemas.LoopRun[]>({
    queryKey: loopsKeys.runs(loopsClient?.projectId ?? null, loopId ?? ""),
    queryFn: async () => {
      if (!loopsClient || !loopId) throw new Error("Not authenticated");
      const page = await listLoopRuns(
        loopsClient.client,
        loopsClient.projectId,
        loopId,
        { limit: RECENT_RUNS_LIMIT },
      );
      const activeRuns = page.results.filter(
        (run) => run.status === "in_progress",
      );
      if (activeRuns.length === 0) return page;

      const taskClient = await getAuthenticatedClient();
      if (!taskClient) return page;

      const tasks = await Promise.allSettled(
        activeRuns.map(async (run) => ({
          run,
          task: (await taskClient.getTask(run.task_id)) as unknown as Task,
        })),
      );
      const reconciled = new Map(
        tasks.flatMap((result) =>
          result.status === "fulfilled"
            ? [
                [
                  result.value.run.id,
                  reconcileLoopRunStatus(result.value.run, result.value.task),
                ] as const,
              ]
            : [],
        ),
      );

      return {
        ...page,
        results: page.results.map((run) => reconciled.get(run.id) ?? run),
      };
    },
    select: (page) => page.results.slice(0, RECENT_RUNS_LIMIT),
    enabled: !!loopsClient && !!loopId,
    staleTime: 10_000,
    refetchInterval: 15_000,
    meta: AUTH_SCOPED_QUERY_META,
  });
}
