import type { SituationId } from "@posthog/core/workflow/schemas";
import type { TaskRunStatus } from "@posthog/shared/domain-types";
import type { SidebarPrState } from "@posthog/ui/features/sidebar/useTaskPrStatus";

export function channelBoardStatus(input: {
  status?: TaskRunStatus;
  prState: SidebarPrState;
  needsPermission: boolean;
  isGenerating: boolean;
  homeSituation?: SituationId | null;
}): SituationId {
  if (input.homeSituation) return input.homeSituation;
  if (input.needsPermission || input.isGenerating) return "working";
  if (input.status === "failed" || input.status === "cancelled") return "done";
  if (input.prState === "merged" || input.prState === "closed") return "done";
  if (input.prState === "open" || input.prState === "draft") return "in_review";
  if (input.status === "completed") return "in_review";
  return "working";
}
