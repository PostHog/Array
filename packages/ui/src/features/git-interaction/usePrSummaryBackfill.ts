import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { taskKeys } from "../tasks/taskKeys";
import { backfillPrSummaries } from "./gitInteractionAdapter";

export function usePrSummaryBackfill(
  taskId: string,
  cloudUrls: string[],
  hasOtherPrs: boolean,
  summaries: Record<string, string>,
): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!hasOtherPrs || cloudUrls.length === 0) return;
    void backfillPrSummaries(taskId, cloudUrls, summaries).then((wrote) => {
      if (wrote) {
        void queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      }
    });
  }, [taskId, cloudUrls, hasOtherPrs, summaries, queryClient]);
}
