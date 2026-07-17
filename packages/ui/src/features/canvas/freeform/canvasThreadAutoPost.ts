import { formatMention } from "@posthog/shared";
import type { UserBasic } from "@posthog/shared/domain-types";
import type { CanvasTerminalStatus } from "@posthog/ui/features/canvas/freeform/canvasGenerationStatus";
import type { TrackedCanvasGeneration } from "@posthog/ui/features/canvas/stores/canvasGenerationTrackerStore";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { canvasShareUrl } from "@posthog/ui/utils/posthogLinks";

export interface CanvasThreadAutoPost {
  kind: "canvas_created" | "turn_complete";
  content: string;
}

function canvasDisplayName(entry: TrackedCanvasGeneration): string {
  // Brackets and newlines would break the `[label](url)` token parsing.
  return entry.name.replace(/[[\]\n]/g, " ").trim() || "Canvas";
}

/**
 * The messages a finished canvas generation drops into its task's thread: a
 * one-time "[name](link) has been created" comment when the run built a brand
 * new canvas, plus a turn-complete note mentioning the task creator. Cancelled
 * runs stay silent — cancellation is user-initiated.
 */
export function buildCanvasGenerationThreadPosts(
  entry: TrackedCanvasGeneration,
  status: CanvasTerminalStatus,
  creator: UserBasic | null | undefined,
): CanvasThreadAutoPost[] {
  if (status === "cancelled") return [];

  const name = canvasDisplayName(entry);
  const posts: CanvasThreadAutoPost[] = [];

  if (status === "completed" && entry.createsCanvas) {
    const url = canvasShareUrl(entry.channelId, entry.dashboardId);
    posts.push({
      kind: "canvas_created",
      content: url
        ? `[${name}](${url}) has been created`
        : `${name} has been created`,
    });
  }

  const mention = creator
    ? `${formatMention(userDisplayName(creator), creator.email)} `
    : "";
  const outcome =
    status === "completed"
      ? `finished generating ${name}`
      : `couldn't finish generating ${name}`;
  posts.push({
    kind: "turn_complete",
    content: `${mention}Turn complete — the agent ${outcome}.`,
  });

  return posts;
}
