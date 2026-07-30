import type { ResourceComment } from "@posthog/api-client/posthog-client";
import {
  type CommentAnchor,
  type CommentContext,
  type CommentTarget,
  isThreadResolved,
  parseCommentContext,
} from "@posthog/core/comments/anchors";
import type { UserBasic } from "@posthog/shared/domain-types";

export type HighlightResolution = "exact" | "reanchored" | "orphaned";
export type CommentLocateRequest = { id: string; nonce: number };

export function readCommentContext(
  comment: ResourceComment,
): CommentContext | null {
  return parseCommentContext(comment.item_context);
}

export type CommentThread = {
  root: ResourceComment;
  replies: ResourceComment[];
  resolved: boolean;
};

/**
 * The contract every comment surface (markdown, uploaded HTML, image, and later
 * canvas) already consumes. Naming the existing shape is deliberate: surfaces
 * stay dumb controlled components, so no registry or plugin layer is needed.
 */
export type CommentSurfaceProps = {
  /** Open roots only — resolved threads must not produce highlights or pins. */
  comments: ResourceComment[];
  activeThreadId: string | null;
  locateRequest: CommentLocateRequest | null;
  members: UserBasic[];
  onActivateThread: (id: string) => void;
  onCreate: (
    anchor: CommentAnchor,
    content: string,
    mentions: number[],
  ) => void;
};

/** Where a thread came from, for surfaces that list threads across resources. */
export type CommentThreadSource = {
  target: CommentTarget;
  name: string;
  /** Present for run artifacts, which need it to open their preview tab. */
  runId?: string;
};

export type SourcedCommentThread = CommentThread & {
  source: CommentThreadSource;
};

export function buildCommentThreads(
  comments: ResourceComment[],
): CommentThread[] {
  const roots: ResourceComment[] = [];
  const repliesByRoot = new Map<string, ResourceComment[]>();
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
        resolved: isThreadResolved(root, replies),
      };
    });
}
