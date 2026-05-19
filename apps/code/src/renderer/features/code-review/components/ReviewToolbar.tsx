import { Tooltip } from "@components/ui/Tooltip";
import { useDiffViewerStore } from "@features/code-editor/stores/diffViewerStore";
import { ArrowsClockwise, Columns, Rows, X } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { Flex, Separator, Text } from "@radix-ui/themes";
import { DiffSettingsMenu } from "@renderer/features/code-review/components/DiffSettingsMenu";
import { DiffSourceSelector } from "@renderer/features/code-review/components/DiffSourceSelector";
import {
  type ReviewMode,
  useReviewNavigationStore,
} from "@renderer/features/code-review/stores/reviewNavigationStore";
import type { ResolvedDiffSource } from "@renderer/features/code-review/utils/resolveDiffSource";
import { FoldVertical, Maximize, Minimize, UnfoldVertical } from "lucide-react";
import { memo } from "react";

interface ReviewToolbarProps {
  taskId: string;
  fileCount: number;
  linesAdded: number;
  linesRemoved: number;
  allExpanded: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onRefresh?: () => void;
  effectiveSource?: ResolvedDiffSource;
  branchSourceAvailable?: boolean;
  prSourceAvailable?: boolean;
  defaultBranch?: string | null;
}

export const ReviewToolbar = memo(function ReviewToolbar({
  taskId,
  fileCount,
  allExpanded,
  onExpandAll,
  onCollapseAll,
  onRefresh,
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
        <Text className="font-medium text-[13px]">
          {fileCount} file{fileCount !== 1 ? "s" : ""} changed
        </Text>
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
        {onRefresh && (
          <Tooltip content="Refresh diff">
            <Button size="icon-sm" onClick={onRefresh} className="rounded-xs">
              <ArrowsClockwise size={14} />
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
