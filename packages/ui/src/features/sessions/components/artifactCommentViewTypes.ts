import type { ArtifactComment } from "@posthog/api-client/posthog-client";
import {
  type ArtifactCommentContext,
  isArtifactThreadResolved,
  parseArtifactCommentContext,
} from "@posthog/core/artifact-comments/anchors";

export type HighlightResolution = "exact" | "reanchored" | "orphaned";
export type ArtifactLocateRequest = { id: string; nonce: number };

export function readArtifactCommentContext(
  comment: ArtifactComment,
): ArtifactCommentContext | null {
  return parseArtifactCommentContext(comment.item_context);
}

export type ArtifactCommentThread = {
  root: ArtifactComment;
  replies: ArtifactComment[];
  resolved: boolean;
};

export function buildArtifactCommentThreads(
  comments: ArtifactComment[],
): ArtifactCommentThread[] {
  const roots: ArtifactComment[] = [];
  const repliesByRoot = new Map<string, ArtifactComment[]>();
  for (const comment of comments) {
    if (!comment.source_comment) {
      roots.push(comment);
      continue;
    }
    const replies = repliesByRoot.get(comment.source_comment) ?? [];
    replies.push(comment);
    repliesByRoot.set(comment.source_comment, replies);
  }
  return roots
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((root) => {
      const replies = repliesByRoot.get(root.id) ?? [];
      return {
        root,
        replies,
        resolved: isArtifactThreadResolved(root, replies),
      };
    });
}
