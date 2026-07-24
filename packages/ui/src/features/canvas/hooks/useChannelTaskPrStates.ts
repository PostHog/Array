import { useHostTRPC } from "@posthog/host-router/react";
import type { Task } from "@posthog/shared/domain-types";
import type { PrStateDetails } from "@posthog/ui/features/git-interaction/usePrDetails";
import type { SidebarPrState } from "@posthog/ui/features/sidebar/useTaskPrStatus";
import { keepPreviousData, useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

const PR_STALE_TIME_MS = 60_000;
const PR_CACHE_TIME_MS = 30 * 60_000;

export function prDetailsToState(
  details: PrStateDetails | undefined,
): SidebarPrState {
  if (!details) return null;
  if (details.merged) return "merged";
  if (details.state === "closed") return "closed";
  if (details.draft) return "draft";
  if (details.state === "open") return "open";
  return null;
}

export function taskPrUrl(
  task: Task,
  prUrlByTaskId: ReadonlyMap<string, string>,
): string | null {
  return (
    prUrlByTaskId.get(task.id) ??
    (typeof task.latest_run?.output?.pr_url === "string"
      ? task.latest_run.output.pr_url
      : null)
  );
}

export interface ChannelTaskPrStates {
  states: Map<string, SidebarPrState>;
  pendingTaskIds: Set<string>;
  isResolving: boolean;
  isRefreshing: boolean;
}

export function useChannelTaskPrStates(
  tasks: Task[],
  prUrlByTaskId: ReadonlyMap<string, string>,
): ChannelTaskPrStates {
  const trpc = useHostTRPC();
  const prUrls = useMemo(
    () => [
      ...new Set(
        tasks.flatMap((task) => {
          const prUrl = taskPrUrl(task, prUrlByTaskId);
          return prUrl ? [prUrl] : [];
        }),
      ),
    ],
    [prUrlByTaskId, tasks],
  );
  const results = useQueries({
    queries: prUrls.map((prUrl) => ({
      ...trpc.git.getPrDetailsByUrl.queryOptions({ prUrl }),
      staleTime: PR_STALE_TIME_MS,
      gcTime: PR_CACHE_TIME_MS,
      placeholderData: keepPreviousData,
      retry: 1,
    })),
  });

  return useMemo(() => {
    const resultByUrl = new Map(
      prUrls.map((url, index) => [url, results[index]]),
    );
    const states = new Map<string, SidebarPrState>();
    const pendingTaskIds = new Set<string>();
    let isRefreshing = false;

    for (const task of tasks) {
      const prUrl = taskPrUrl(task, prUrlByTaskId);
      const result = prUrl ? resultByUrl.get(prUrl) : undefined;
      if (prUrl && result && !result.data && result.isPending) {
        pendingTaskIds.add(task.id);
      }
      if (result?.data && result.isFetching) isRefreshing = true;
      states.set(
        task.id,
        prDetailsToState(
          result?.data?.state === "unknown" ? undefined : result?.data,
        ),
      );
    }

    return {
      states,
      pendingTaskIds,
      isResolving: pendingTaskIds.size > 0,
      isRefreshing,
    };
  }, [prUrlByTaskId, prUrls, results, tasks]);
}
