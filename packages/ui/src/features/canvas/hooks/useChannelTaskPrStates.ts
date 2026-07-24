import type { Task } from "@posthog/shared/domain-types";
import {
  type PrStateDetails,
  usePrDetailsMap,
} from "@posthog/ui/features/git-interaction/usePrDetails";
import type { SidebarPrState } from "@posthog/ui/features/sidebar/useTaskPrStatus";
import { useMemo } from "react";

export function prDetailsToState(
  details: PrStateDetails | undefined,
): SidebarPrState {
  if (!details) return null;
  if (details.merged) return "merged";
  if (details.draft) return "draft";
  if (details.state === "open") return "open";
  if (details.state === "closed") return "closed";
  return null;
}

export function useChannelTaskPrStates(
  tasks: Task[],
  prUrlByTaskId: ReadonlyMap<string, string>,
): Map<string, SidebarPrState> {
  const prUrls = useMemo(
    () =>
      tasks.flatMap((task) => {
        const prUrl =
          prUrlByTaskId.get(task.id) ??
          (typeof task.latest_run?.output?.pr_url === "string"
            ? task.latest_run.output.pr_url
            : null);
        return prUrl ? [prUrl] : [];
      }),
    [prUrlByTaskId, tasks],
  );
  const detailsByUrl = usePrDetailsMap(prUrls);
  return useMemo(
    () =>
      new Map(
        tasks.map((task) => {
          const prUrl =
            prUrlByTaskId.get(task.id) ??
            (typeof task.latest_run?.output?.pr_url === "string"
              ? task.latest_run.output.pr_url
              : null);
          return [
            task.id,
            prDetailsToState(prUrl ? detailsByUrl[prUrl] : undefined),
          ];
        }),
      ),
    [detailsByUrl, prUrlByTaskId, tasks],
  );
}
