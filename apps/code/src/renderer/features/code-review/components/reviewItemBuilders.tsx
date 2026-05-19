import { makeFileKey } from "@features/git-interaction/utils/fileKey";
import type { parsePatchFiles } from "@pierre/diffs";
import type { ChangedFile } from "@shared/types";
import type { DiffOptions } from "../types";
import type { PrCommentThread } from "../utils/prCommentAnnotations";
import { PatchRow, RemoteRow, UntrackedRow } from "./ReviewRows";
import type { ReviewListItem } from "./ReviewShell";

interface BuildPatchReviewItemsArgs {
  files: ReturnType<typeof parsePatchFiles>[number]["files"];
  staged?: boolean;
  alsoStagedPaths?: Set<string>;
  repoPath: string;
  taskId: string;
  diffOptions: DiffOptions;
  collapsedFiles: Set<string>;
  toggleFile: (key: string) => void;
  openFile: (taskId: string, path: string, preview: boolean) => void;
  prUrl: string | null;
  commentThreads?: Map<number, PrCommentThread>;
}

export function buildPatchReviewItems({
  files,
  staged = false,
  alsoStagedPaths,
  repoPath,
  taskId,
  diffOptions,
  collapsedFiles,
  toggleFile,
  openFile,
  prUrl,
  commentThreads,
}: BuildPatchReviewItemsArgs): ReviewListItem[] {
  return files.map((fileDiff) => {
    const filePath = fileDiff.name ?? fileDiff.prevName ?? "";
    const key = makeFileKey(staged, filePath);
    const isCollapsed = collapsedFiles.has(key);
    const skipExpansion = staged || (alsoStagedPaths?.has(filePath) ?? false);

    return {
      key,
      scrollKey: key,
      node: (
        <PatchRow
          itemKey={key}
          filePath={filePath}
          fileDiff={fileDiff}
          repoPath={repoPath}
          taskId={taskId}
          diffOptions={diffOptions}
          collapsed={isCollapsed}
          skipExpansion={skipExpansion}
          toggleFile={toggleFile}
          openFile={openFile}
          prUrl={prUrl}
          commentThreads={commentThreads}
        />
      ),
    };
  });
}

interface BuildUntrackedReviewItemsArgs {
  files: ChangedFile[];
  repoPath: string;
  taskId: string;
  diffOptions: DiffOptions;
  collapsedFiles: Set<string>;
  toggleFile: (key: string) => void;
}

export function buildUntrackedReviewItems({
  files,
  repoPath,
  taskId,
  diffOptions,
  collapsedFiles,
  toggleFile,
}: BuildUntrackedReviewItemsArgs): ReviewListItem[] {
  return files.map((file) => {
    const key = makeFileKey(file.staged, file.path);
    const isCollapsed = collapsedFiles.has(key);

    return {
      key,
      scrollKey: key,
      node: (
        <UntrackedRow
          itemKey={key}
          file={file}
          repoPath={repoPath}
          taskId={taskId}
          diffOptions={diffOptions}
          collapsed={isCollapsed}
          toggleFile={toggleFile}
        />
      ),
    };
  });
}

interface BuildRemoteReviewItemsArgs {
  files: ChangedFile[];
  taskId: string;
  prUrl?: string | null;
  options: DiffOptions;
  collapsedFiles: Set<string>;
  toggleFile: (path: string) => void;
  commentThreads?: Map<number, PrCommentThread>;
}

export function buildRemoteReviewItems({
  files,
  taskId,
  prUrl,
  options,
  collapsedFiles,
  toggleFile,
  commentThreads,
}: BuildRemoteReviewItemsArgs): ReviewListItem[] {
  return files.map((file) => {
    const isCollapsed = collapsedFiles.has(file.path);
    const githubFileUrl = prUrl
      ? `${prUrl}/files#diff-${file.path.replaceAll("/", "-")}`
      : undefined;

    return {
      key: file.path,
      scrollKey: file.path,
      node: (
        <RemoteRow
          file={file}
          taskId={taskId}
          prUrl={prUrl}
          options={options}
          collapsed={isCollapsed}
          toggleFile={toggleFile}
          commentThreads={commentThreads}
          externalUrl={githubFileUrl}
        />
      ),
    };
  });
}
