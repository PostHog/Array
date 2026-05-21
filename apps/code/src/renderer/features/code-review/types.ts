import type { PrReviewComment } from "@main/services/git/schemas";
import type { AnnotationSide, FileDiffOptions } from "@pierre/diffs";
import type { FileDiffProps, MultiFileDiffProps } from "@pierre/diffs/react";
import type { PrCommentThread } from "./utils/prCommentAnnotations";

export interface HunkRevertMetadata {
  kind: "hunk-revert";
  hunkIndex: number;
}

export interface CommentMetadata {
  kind: "comment";
  startLine: number;
  endLine: number;
  side: AnnotationSide;
}

export interface DraftCommentMetadata {
  kind: "draft-comment";
  draftId: string;
  startLine: number;
  endLine: number;
  side: AnnotationSide;
}

export interface PrCommentMetadata {
  kind: "pr-comment";
  threadId: number;
  comments: PrReviewComment[];
  isOutdated: boolean;
  isFileLevel: boolean;
  startLine: number | null;
  endLine: number;
  side: AnnotationSide;
}

export type AnnotationMetadata =
  | HunkRevertMetadata
  | CommentMetadata
  | DraftCommentMetadata
  | PrCommentMetadata;

export type DiffOptions = FileDiffOptions<AnnotationMetadata>;

interface PrCommentProps {
  taskId?: string;
  prUrl?: string | null;
  commentThreads?: Map<number, PrCommentThread>;
}

export type PatchDiffProps = FileDiffProps<AnnotationMetadata> &
  PrCommentProps & {
    repoPath?: string;
    skipExpansion?: boolean;
  };

export type FilesDiffProps = MultiFileDiffProps<AnnotationMetadata> &
  PrCommentProps;

export type InteractiveFileDiffProps = PatchDiffProps | FilesDiffProps;
