import { useDiffViewerStore } from "@features/code-editor/stores/diffViewerStore";
import { usePrDetails } from "@features/git-interaction/hooks/usePrDetails";
import { useCloudChangedFiles } from "@features/task-detail/hooks/useCloudChangedFiles";
import { extractCloudFileDiff } from "@features/task-detail/utils/cloudToolChanges";
import { Flex, Spinner, Text } from "@radix-ui/themes";
import { useReviewNavigationStore } from "@renderer/features/code-review/stores/reviewNavigationStore";
import type { Task } from "@shared/types";
import { useMemo } from "react";
import { PatchedFileDiff } from "./PatchedFileDiff";
import {
  buildItemIndex,
  type ReviewListItem,
  ReviewShell,
  useReviewState,
} from "./ReviewShell";

interface CloudReviewPageProps {
  task: Task;
}

export function CloudReviewPage({ task }: CloudReviewPageProps) {
  const taskId = task.id;
  const isReviewOpen = useReviewNavigationStore(
    (s) => (s.reviewModes[taskId] ?? "closed") !== "closed",
  );
  const showReviewComments = useDiffViewerStore((s) => s.showReviewComments);
  const {
    effectiveBranch,
    prUrl,
    isRunActive,
    remoteFiles,
    reviewFiles,
    toolCalls,
    isLoading,
  } = useCloudChangedFiles(taskId, task, isReviewOpen);
  const { commentThreads } = usePrDetails(prUrl, {
    includeComments: isReviewOpen && showReviewComments,
  });

  const allPaths = useMemo(() => reviewFiles.map((f) => f.path), [reviewFiles]);

  const {
    diffOptions,
    linesAdded,
    linesRemoved,
    collapsedFiles,
    toggleFile,
    expandAll,
    collapseAll,
    uncollapseFile,
  } = useReviewState(reviewFiles, allPaths);

  const toolCallFallbacks = useMemo(() => {
    if (remoteFiles.length > 0) return undefined;
    const diffs = new Map<
      string,
      { oldText: string | null; newText: string | null }
    >();
    for (const file of reviewFiles) {
      const diff = extractCloudFileDiff(toolCalls, file.path);
      if (diff) diffs.set(file.path, diff);
    }
    return diffs;
  }, [remoteFiles.length, toolCalls, reviewFiles]);

  const items = useMemo<ReviewListItem[]>(() => {
    return reviewFiles.map((file) => {
      const isCollapsed = collapsedFiles.has(file.path);
      const githubFileUrl = prUrl
        ? `${prUrl}/files#diff-${file.path.replaceAll("/", "-")}`
        : undefined;

      return {
        key: file.path,
        scrollKey: file.path,
        node: (
          <PatchedFileDiff
            file={file}
            taskId={taskId}
            prUrl={prUrl}
            options={diffOptions}
            collapsed={isCollapsed}
            onToggle={() => toggleFile(file.path)}
            commentThreads={showReviewComments ? commentThreads : undefined}
            fallback={toolCallFallbacks?.get(file.path) ?? null}
            externalUrl={githubFileUrl}
          />
        ),
      };
    });
  }, [
    collapsedFiles,
    commentThreads,
    diffOptions,
    prUrl,
    reviewFiles,
    showReviewComments,
    taskId,
    toggleFile,
    toolCallFallbacks,
  ]);

  const itemIndexByFilePath = useMemo(() => buildItemIndex(items), [items]);

  if (!prUrl && !effectiveBranch && reviewFiles.length === 0) {
    if (isRunActive) {
      return (
        <Flex
          align="center"
          justify="center"
          height="100%"
          className="text-gray-10"
        >
          <Flex direction="column" align="center" gap="2">
            <Spinner size="2" />
            <Text className="text-sm">Waiting for changes...</Text>
          </Flex>
        </Flex>
      );
    }
    return null;
  }

  return (
    <ReviewShell
      task={task}
      fileCount={reviewFiles.length}
      linesAdded={linesAdded}
      linesRemoved={linesRemoved}
      isLoading={isLoading && reviewFiles.length === 0}
      isEmpty={reviewFiles.length === 0}
      allExpanded={collapsedFiles.size === 0}
      onExpandAll={expandAll}
      onCollapseAll={collapseAll}
      onUncollapseFile={uncollapseFile}
      items={items}
      itemIndexByFilePath={itemIndexByFilePath}
    />
  );
}
