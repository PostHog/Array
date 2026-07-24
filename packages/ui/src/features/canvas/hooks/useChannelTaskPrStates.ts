import type { Task } from "@posthog/shared/domain-types";
import {
  type PrStateDetails,
  usePrDetailsQueries,
} from "@posthog/ui/features/git-interaction/usePrDetails";
import type { SidebarPrState } from "@posthog/ui/features/sidebar/useTaskPrStatus";
import { useMemo } from "react";

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

export function taskPrUrl(task: Task): string | null {
  return typeof task.latest_run?.output?.pr_url === "string"
    ? task.latest_run.output.pr_url
    : null;
}

export interface ChannelTaskPrStates {
  states: Map<string, SidebarPrState>;
  pendingTaskIds: Set<string>;
  isResolving: boolean;
  isRefreshing: boolean;
}

export function useChannelTaskPrStates(tasks: Task[]): ChannelTaskPrStates {
  const prUrls = useMemo(
    () => [
      ...new Set(
        tasks.flatMap((task) => {
          const prUrl = taskPrUrl(task);
          return prUrl ? [prUrl] : [];
        }),
      ),
    ],
    [tasks],
  );
  const results = usePrDetailsQueries(prUrls);

  return useMemo(() => {
    const resultByUrl = new Map(
      prUrls.map((url, index) => [url, results[index]]),
    );
    const states = new Map<string, SidebarPrState>();
    const pendingTaskIds = new Set<string>();
    let isRefreshing = false;

    for (const task of tasks) {
      const prUrl = taskPrUrl(task);
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
  }, [prUrls, results, tasks]);
}
