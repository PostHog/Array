import type { Schemas } from "@posthog/api-client/generated";
import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import { injectable } from "inversify";
import {
  CANVAS_COMMENTS_SCOPE,
  type CanvasComment,
  type CanvasCommentContext,
  type CanvasCommentThread,
  canvasCommentContextSchema,
} from "./canvasCommentsSchemas";
import type { CommentAnchor } from "./htmlCanvasSchemas";

export const CANVAS_COMMENTS_SERVICE = Symbol.for(
  "posthog.core.canvas.commentsService",
);

// Map an API comment row to the app shape. Deleted rows return null (soft
// delete: the API keeps them, filtered here). A context that fails to parse —
// a foreign writer, an older schema — degrades to `anchor: null` rather than
// throwing, so one bad row can never take down the whole panel.
export function parseCanvasComment(raw: Schemas.Comment): CanvasComment | null {
  if (raw.deleted) return null;
  const context = canvasCommentContextSchema.safeParse(raw.item_context);
  const createdBy = raw.created_by;
  const name =
    [createdBy?.first_name, createdBy?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    createdBy?.email ||
    "Unknown";
  return {
    id: raw.id,
    content: raw.content ?? "",
    createdAt: Date.parse(raw.created_at) || 0,
    createdBy: {
      uuid: createdBy?.uuid ?? "",
      name,
      email: createdBy?.email ?? "",
    },
    anchor: context.success ? (context.data.anchor ?? null) : null,
    sourceCommentId: raw.source_comment ?? null,
  };
}

// Group parsed comments into threads: roots oldest-first with 1-based pin
// indexes, replies oldest-first under their root. A reply whose root is
// missing (root hard-deleted / not returned) is promoted to its own root so
// the content stays reachable.
export function groupThreads(comments: CanvasComment[]): CanvasCommentThread[] {
  const byCreated = [...comments].sort((a, b) => a.createdAt - b.createdAt);
  const rootIds = new Set(
    byCreated.filter((c) => !c.sourceCommentId).map((c) => c.id),
  );
  const roots: CanvasComment[] = [];
  const repliesByRoot = new Map<string, CanvasComment[]>();
  for (const comment of byCreated) {
    const rootId = comment.sourceCommentId;
    if (rootId && rootIds.has(rootId)) {
      const replies = repliesByRoot.get(rootId) ?? [];
      replies.push(comment);
      repliesByRoot.set(rootId, replies);
    } else {
      roots.push(comment);
    }
  }
  return roots.map((root, i) => ({
    root,
    replies: repliesByRoot.get(root.id) ?? [],
    index: i + 1,
  }));
}

// Comments on a canvas artifact, stored on PostHog's generic comments API
// (scope CANVAS_COMMENTS_SCOPE, item_id = the canvas's file-system id, the
// anchor riding in `item_context`). Client-as-parameter like TaskThreadService:
// the renderer resolves the authenticated client and passes it per call.
@injectable()
export class CanvasCommentsService {
  async listThreads(
    client: PostHogAPIClient,
    dashboardId: string,
  ): Promise<CanvasCommentThread[]> {
    const raw = await client.listComments(CANVAS_COMMENTS_SCOPE, dashboardId);
    const parsed = raw
      .map(parseCanvasComment)
      .filter((c): c is CanvasComment => c !== null);
    return groupThreads(parsed);
  }

  async addComment(
    client: PostHogAPIClient,
    input: {
      dashboardId: string;
      content: string;
      anchor: CommentAnchor;
      canvasVersionId?: string;
    },
  ): Promise<CanvasComment | null> {
    const context: CanvasCommentContext = {
      version: 1,
      anchor: input.anchor,
      ...(input.canvasVersionId
        ? { canvasVersionId: input.canvasVersionId }
        : {}),
    };
    const created = await client.createComment({
      content: input.content,
      scope: CANVAS_COMMENTS_SCOPE,
      item_id: input.dashboardId,
      item_context: context,
    });
    return parseCanvasComment(created);
  }

  async addReply(
    client: PostHogAPIClient,
    input: { dashboardId: string; content: string; rootId: string },
  ): Promise<CanvasComment | null> {
    const context: CanvasCommentContext = { version: 1 };
    const created = await client.createComment({
      content: input.content,
      scope: CANVAS_COMMENTS_SCOPE,
      item_id: input.dashboardId,
      item_context: context,
      source_comment: input.rootId,
    });
    return parseCanvasComment(created);
  }

  // Soft delete — the API disables DELETE (405); deletion is a PATCH.
  async remove(client: PostHogAPIClient, commentId: string): Promise<void> {
    await client.patchComment(commentId, { deleted: true });
  }
}
