import type { TaskRunStatus } from "@posthog/shared/domain-types";
import type { SidebarPrState } from "@posthog/ui/features/sidebar/useTaskPrStatus";

export type ChannelBoardStatus = "todo" | "in_progress" | "ready" | "closed";

export function channelBoardStatus(input: {
  status?: TaskRunStatus;
  prState: SidebarPrState;
  needsPermission: boolean;
  isGenerating: boolean;
}): ChannelBoardStatus {
  if (input.needsPermission || input.isGenerating) return "in_progress";
  if (input.status === "failed" || input.status === "cancelled")
    return "closed";
  if (input.prState === "merged" || input.prState === "closed") return "closed";
  if (input.prState === "open" || input.prState === "draft") return "ready";
  if (input.status === "completed") return "ready";
  if (input.status === "in_progress") return "in_progress";
  return "todo";
}
