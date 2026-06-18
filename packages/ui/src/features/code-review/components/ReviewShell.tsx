import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { useService } from "@posthog/di/react";
import type { Task } from "@posthog/shared/domain-types";
import { Flex, Spinner, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { VList, type VListHandle } from "virtua";
import {
  REVIEW_LIST_BUFFER_PX,
  REVIEW_LIST_ESTIMATED_ITEM_SIZE,
} from "../constants";
import { useReviewDraftsStore } from "../reviewDraftsStore";
import { REVIEW_HOST, type ReviewHost } from "../reviewHost";
import { useReviewNavigationStore } from "../reviewNavigationStore";
import type { ReviewListItem, ReviewShellProps } from "../reviewShellParts";
import { PendingReviewBar } from "./PendingReviewBar";
import { ReviewToolbar } from "./ReviewToolbar";

// Pure helpers, hooks, types, and presentational sub-components live in
// ../reviewShellParts. Re-exported here so consumers can import everything
// (ReviewShell + useReviewState + buildItemIndex + ReviewListItem) from a
// single "./ReviewShell" specifier.
export * from "../reviewShellParts";

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 500;
const SIDEBAR_DEFAULT_WIDTH = 280;

function ExpandedSidebar({ task }: { task: Task }) {
  const reviewHost = useService<ReviewHost>(REVIEW_HOST);
  const [width, setWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      const startX = e.clientX;
      const startWidth = width;

      const handleMouseMove = (e: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = startX - e.clientX;
        const newWidth = Math.min(
          SIDEBAR_MAX_WIDTH,
          Math.max(SIDEBAR_MIN_WIDTH, startWidth + delta),
        );
        setWidth(newWidth);
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width],
  );

  return (
    <Flex direction="row" className="shrink-0">
      <button
        type="button"
        aria-label="Resize sidebar"
        onMouseDown={handleMouseDown}
        style={{ transition: "background 0.1s" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--accent-8)";
        }}
        onMouseLeave={(e) => {
          if (!isDragging.current) {
            e.currentTarget.style.background = "transparent";
          }
        }}
        className="w-[4px] shrink-0 cursor-col-resize border-l border-l-(--gray-6) bg-transparent p-0"
      />
      <Flex
        direction="column"
        style={{
          width: `${width}px`,
          minWidth: `${SIDEBAR_MIN_WIDTH}px`,
        }}
        className="shrink-0 bg-(--color-background)"
      >
        {reviewHost.renderExpandedSidebar(task)}
      </Flex>
    </Flex>
  );
}

export function ReviewShell({
  task,
  fileCount,
  linesAdded,
  linesRemoved,
  isLoading,
  isEmpty,
  items,
  itemIndexByFilePath,
  onUncollapseFile,
  allExpanded,
  onExpandAll,
  onCollapseAll,
  onRefresh,
  effectiveSource,
  branchSourceAvailable,
  prSourceAvailable,
  defaultBranch,
}: ReviewShellProps) {
  const reviewHost = useService<ReviewHost>(REVIEW_HOST);
  const taskId = task.id;
  const listRef = useRef<VListHandle | null>(null);

  const workerFactory = useCallback(
    () => reviewHost.diffWorkerFactory(),
    [reviewHost],
  );

  const reviewMode = useReviewNavigationStore(
    (s) => s.reviewModes[taskId] ?? "closed",
  );
  const isExpanded = reviewMode === "expanded";

  const scrollRequest = useReviewNavigationStore(
    (s) => s.scrollRequests[taskId] ?? null,
  );
  const clearScrollRequest = useReviewNavigationStore(
    (s) => s.clearScrollRequest,
  );
  const setActiveFilePath = useReviewNavigationStore(
    (s) => s.setActiveFilePath,
  );
  const clearTask = useReviewNavigationStore((s) => s.clearTask);

  useEffect(() => {
    return () => {
      clearTask(taskId);
      useReviewDraftsStore.getState().clearDrafts(taskId);
    };
  }, [taskId, clearTask]);

  useEffect(() => {
    if (!scrollRequest) return;
    const targetIndex = itemIndexByFilePath.get(scrollRequest);
    if (targetIndex === undefined) return;

    onUncollapseFile?.(scrollRequest);
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex(targetIndex, { align: "start" });
      setActiveFilePath(taskId, scrollRequest);
      clearScrollRequest(taskId);
    });
  }, [
    clearScrollRequest,
    itemIndexByFilePath,
    onUncollapseFile,
    scrollRequest,
    setActiveFilePath,
    taskId,
  ]);

  const lastActiveRef = useRef<string | null>(null);
  const handleScroll = useCallback(
    (offset: number) => {
      const handle = listRef.current;
      if (!handle) return;
      const index = handle.findItemIndex(offset);
      const item = items[index];
      const scrollKey = item?.scrollKey;
      if (!scrollKey || scrollKey === lastActiveRef.current) return;
      lastActiveRef.current = scrollKey;
      setActiveFilePath(taskId, scrollKey);
    },
    [items, setActiveFilePath, taskId],
  );

  const renderItem = useCallback(
    (item: ReviewListItem) => (
      <div
        key={item.key}
        data-scroll-key={item.scrollKey}
        className="pb-2 last:pb-0"
      >
        {item.node}
      </div>
    ),
    [],
  );

  return (
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory }}
      highlighterOptions={{
        theme: { dark: "github-dark", light: "github-light" },
        langs: [
          "typescript",
          "tsx",
          "javascript",
          "jsx",
          "json",
          "css",
          "html",
          "markdown",
          "python",
          "ruby",
          "go",
          "rust",
          "shell",
          "yaml",
          "sql",
        ],
      }}
    >
      <Flex direction="column" height="100%" id="review-shell">
        <ReviewToolbar
          taskId={taskId}
          fileCount={fileCount}
          linesAdded={linesAdded}
          linesRemoved={linesRemoved}
          allExpanded={allExpanded}
          onExpandAll={onExpandAll}
          onCollapseAll={onCollapseAll}
          onRefresh={onRefresh}
          effectiveSource={effectiveSource}
          branchSourceAvailable={branchSourceAvailable}
          prSourceAvailable={prSourceAvailable}
          defaultBranch={defaultBranch}
        />
        <Flex className="min-h-0 flex-1">
          <Flex direction="column" className="min-w-0 flex-1">
            {isLoading ? (
              <Flex align="center" justify="center" className="min-h-0 flex-1">
                <Spinner size="2" />
              </Flex>
            ) : isEmpty ? (
              <Flex align="center" justify="center" className="min-h-0 flex-1">
                <Text color="gray" className="text-sm">
                  No file changes to review
                </Text>
              </Flex>
            ) : (
              <VList
                ref={listRef}
                bufferSize={REVIEW_LIST_BUFFER_PX}
                itemSize={REVIEW_LIST_ESTIMATED_ITEM_SIZE}
                className="pierre-scroll-root scrollbar-overlay-y min-h-0 flex-1 overflow-auto bg-(--gray-2)"
                shift={false}
                style={{ scrollbarGutter: "stable" }}
                onScroll={handleScroll}
                data={items}
              >
                {renderItem}
              </VList>
            )}
            <PendingReviewBar taskId={taskId} />
          </Flex>

          {isExpanded && <ExpandedSidebar task={task} />}
        </Flex>
      </Flex>
    </WorkerPoolContextProvider>
  );
}
