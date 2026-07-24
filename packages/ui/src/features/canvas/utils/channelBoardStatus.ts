import type { TaskRunStatus } from "@posthog/shared/domain-types";
import type { SidebarPrState } from "@posthog/ui/features/sidebar/useTaskPrStatus";

export const CHANNEL_NEEDS_FEEDBACK_STATE_KEY = "posthog_code_needs_feedback";

export type ChannelBoardStatus =
  | "in_progress"
  | "needs_feedback"
  | "ready"
  | "closed";

export function taskNeedsFeedback(
  state: Record<string, unknown> | undefined,
): boolean {
  return state?.[CHANNEL_NEEDS_FEEDBACK_STATE_KEY] === true;
}

export function channelBoardStatus(input: {
  status?: TaskRunStatus;
  prState: SidebarPrState;
  needsPermission: boolean;
  isGenerating: boolean;
  needsFeedback: boolean;
}): ChannelBoardStatus {
  if (input.needsPermission || input.isGenerating) return "in_progress";
  if (input.status === "failed" || input.status === "cancelled")
    return "closed";
  if (input.prState === "merged" || input.prState === "closed") return "closed";
  if (input.needsFeedback) return "needs_feedback";
  if (input.prState === "open" || input.prState === "draft") return "ready";
  if (input.status === "completed") return "ready";
  if (input.status === "in_progress") return "in_progress";
  return "in_progress";
}
