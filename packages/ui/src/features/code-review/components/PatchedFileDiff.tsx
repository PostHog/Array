import { type FileDiffMetadata, processFile } from "@pierre/diffs";
import type { PrCommentThread } from "@posthog/core/code-review/types";
import type { ChangedFile } from "@posthog/shared/domain-types";
import { useMemo } from "react";
import { DeferredDiffPlaceholder, DiffFileHeader } from "../reviewShellParts";
import type { DiffOptions } from "../types";
import { InteractiveFileDiff } from "./InteractiveFileDiff";

interface PatchedFileDiffProps {
  file: ChangedFile;
  taskId: string;
  options: DiffOptions;
  collapsed: boolean;
  onToggle: () => void;
  fallback?: { oldText: string | null; newText: string | null } | null;
  externalUrl?: string;
  prUrl?: string | null;
  commentThreads?: Map<number, PrCommentThread>;
}

export function PatchedFileDiff({
  file,
  taskId,
  options,
  collapsed,
  onToggle,
  fallback,
  externalUrl,
  prUrl,
  commentThreads,
}: PatchedFileDiffProps) {
  const fileDiff = useMemo((): FileDiffMetadata | undefined => {
    if (!file.patch) return undefined;
    return processFile(file.patch, { isGitDiff: true });
  }, [file.patch]);

  const diffSourceProps = useMemo(() => {
    if (fileDiff) return { fileDiff };
    if (fallback) {
      const name = file.path.split("/").pop() || file.path;
      return {
        oldFile: { name, contents: fallback.oldText ?? "" },
        newFile: { name, contents: fallback.newText ?? "" },
      };
    }
    return null;
  }, [fileDiff, fallback, file.path]);

  if (!diffSourceProps) {
    return (
      <DeferredDiffPlaceholder
        filePath={file.path}
        linesAdded={file.linesAdded ?? 0}
        linesRemoved={file.linesRemoved ?? 0}
        reason="unavailable"
        collapsed={collapsed}
        onToggle={onToggle}
        externalUrl={externalUrl}
      />
    );
  }

  return (
    <InteractiveFileDiff
      {...diffSourceProps}
      options={{ ...options, collapsed }}
      taskId={taskId}
      prUrl={prUrl}
      commentThreads={commentThreads}
      renderCustomHeader={(fd) => (
        <DiffFileHeader
          fileDiff={fd}
          collapsed={collapsed}
          onToggle={onToggle}
        />
      )}
    />
  );
}
