import {
  ArrowCounterClockwise,
  ArrowsClockwise,
  ChatCircle,
  Columns,
  Rows,
  X,
} from "@phosphor-icons/react";
import type { ResolvedDiffSource } from "@posthog/core/code-review/resolveDiffSource";
import { Button } from "@posthog/quill";
import { useDiffViewerStore } from "@posthog/ui/features/code-editor/diffViewerStore";
import {
  type ReviewMode,
  useReviewNavigationStore,
} from "@posthog/ui/features/code-review/reviewNavigationStore";
import { Tooltip } from "@posthog/ui/primitives/Tooltip";
import { Flex, Separator, Text } from "@radix-ui/themes";
import { FoldVertical, Maximize, Minimize, UnfoldVertical } from "lucide-react";
import { memo } from "react";
import { DiffSettingsMenu } from "./DiffSettingsMenu";
import { DiffSourceSelector } from "./DiffSourceSelector";

interface ReviewToolbarProps {
  taskId: string;
  fileCount: number;
  viewedCount: number;
  commentedFileCount: number;
  showCommentedFilesOnly: boolean;
  onToggleCommentedFilesOnly?: () => void;
  linesAdded: number;
  linesRemoved: number;
  allExpanded: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onRefresh?: () => void;
  onDiscardAll?: () => void;
  effectiveSource?: ResolvedDiffSource;
  branchSourceAvailable?: boolean;
  prSourceAvailable?: boolean;
  defaultBranch?: string | null;
}

function formatFileCount(count: number, suffix: string): string {
  const noun = count === 1 ? "file" : "files";
  return `${count} ${noun} ${suffix}`;
}

export const ReviewToolbar = memo(function ReviewToolbar({
  taskId,
  fileCount,
  viewedCount,
  commentedFileCount,
  showCommentedFilesOnly,
  onToggleCommentedFilesOnly,
  allExpanded,
  onExpandAll,
  onCollapseAll,
  onRefresh,
  onDiscardAll,
  effectiveSource,
  branchSourceAvailable,
  prSourceAvailable,
  defaultBranch,
}: ReviewToolbarProps) {
  const viewMode = useDiffViewerStore((s) => s.viewMode);
  const toggleViewMode = useDiffViewerStore((s) => s.toggleViewMode);
  const reviewMode = useReviewNavigationStore(
    (s) => s.reviewModes[taskId] ?? "closed",
  );
  const setReviewMode = useReviewNavigationStore((s) => s.setReviewMode);

  const handleToggleExpand = () => {
    const next: ReviewMode = reviewMode === "expanded" ? "split" : "expanded";
    setReviewMode(taskId, next);
  };

  const handleClose = () => {
    setReviewMode(taskId, "closed");
  };

  const visibleFileCount = showCommentedFilesOnly
    ? commentedFileCount
    : fileCount;
  const fileCountLabel = showCommentedFilesOnly
    ? formatFileCount(commentedFileCount, "with comments")
    : formatFileCount(fileCount, "changed");

  return (
    <Flex
      id="review-toolbar"
      px="1"
      align="center"
      gap="3"
      style={{
        zIndex: 2,
      }}
      className="sticky top-0 h-[32px] shrink-0 border-b border-b-(--gray-6) bg-(--color-background)"
    >
      <Flex align="center" gap="2">
        <Text className="font-medium text-[13px]">{fileCountLabel}</Text>
        {visibleFileCount > 0 && (
          <Text className="text-(--gray-10) text-[13px]">
            {viewedCount}/{visibleFileCount} viewed
          </Text>
        )}
        {effectiveSource && (
          <DiffSourceSelector
            taskId={taskId}
            effectiveSource={effectiveSource}
            branchAvailable={branchSourceAvailable ?? false}
            prSourceAvailable={prSourceAvailable ?? false}
            defaultBranch={defaultBranch ?? null}
          />
        )}
      </Flex>

      <Flex align="center" gap="1" ml="auto">
        {onToggleCommentedFilesOnly && (
          <Tooltip
            content={
              showCommentedFilesOnly
                ? "Show all files"
                : `Show only files with comments (${commentedFileCount})`
            }
          >
            <Button
              size="icon-sm"
              onClick={onToggleCommentedFilesOnly}
              disabled={commentedFileCount === 0 && !showCommentedFilesOnly}
              aria-label="Filter files with comments"
              aria-pressed={showCommentedFilesOnly}
              className={`rounded-xs ${showCommentedFilesOnly ? "bg-(--gray-4)" : ""}`}
            >
              <ChatCircle
                size={14}
                weight={showCommentedFilesOnly ? "fill" : "regular"}
              />
            </Button>
          </Tooltip>
        )}

        {onRefresh && (
          <Tooltip content="Refresh diff">
            <Button size="icon-sm" onClick={onRefresh} className="rounded-xs">
              <ArrowsClockwise size={14} />
            </Button>
          </Tooltip>
        )}

        {onDiscardAll && (
          <Tooltip content="Revert all local changes">
            <Button
              size="icon-sm"
              onClick={onDiscardAll}
              className="rounded-xs"
            >
              <ArrowCounterClockwise size={14} />
            </Button>
          </Tooltip>
        )}

        <Tooltip content={viewMode === "split" ? "Split view" : "Columns view"}>
          <Button
            size="icon-sm"
            onClick={toggleViewMode}
            className="rounded-xs"
          >
            {viewMode === "split" ? <Rows size={14} /> : <Columns size={14} />}
          </Button>
        </Tooltip>

        <Tooltip content={allExpanded ? "Collapse all" : "Expand all"}>
          <Button
            size="icon-sm"
            onClick={allExpanded ? onCollapseAll : onExpandAll}
            className="rounded-xs"
          >
            {allExpanded ? (
              <FoldVertical size={12} />
            ) : (
              <UnfoldVertical size={12} />
            )}
          </Button>
        </Tooltip>

        <Tooltip
          content={
            reviewMode === "expanded" ? "Collapse review" : "Expand review"
          }
        >
          <Button
            size="icon-sm"
            onClick={handleToggleExpand}
            aria-selected={reviewMode === "expanded"}
            className="rounded-xs"
          >
            {reviewMode === "expanded" ? (
              <Minimize size={12} />
            ) : (
              <Maximize size={12} />
            )}
          </Button>
        </Tooltip>

        <Separator orientation="vertical" size="1" />

        <DiffSettingsMenu />

        <Tooltip content="Close review">
          <Button size="icon-sm" onClick={handleClose} className="rounded-xs">
            <X size={14} />
          </Button>
        </Tooltip>
      </Flex>
    </Flex>
  );
});
