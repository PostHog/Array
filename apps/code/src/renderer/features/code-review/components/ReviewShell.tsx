import { FileIcon } from "@components/ui/FileIcon";
import { useDiffViewerStore } from "@features/code-editor/stores/diffViewerStore";
import { computeDiffStats } from "@features/git-interaction/utils/diffStats";
import { ChangesPanel } from "@features/task-detail/components/ChangesPanel";
import { ArrowSquareOut, CaretDown } from "@phosphor-icons/react";
import type { FileDiffMetadata } from "@pierre/diffs/react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import WorkerUrl from "@pierre/diffs/worker/worker.js?worker&url";
import { Flex, Spinner, Text } from "@radix-ui/themes";
import { useReviewDraftsStore } from "@renderer/features/code-review/stores/reviewDraftsStore";
import { useReviewNavigationStore } from "@renderer/features/code-review/stores/reviewNavigationStore";
import type { ChangedFile, Task } from "@shared/types";
import { useThemeStore } from "@stores/themeStore";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { VList, type VListHandle } from "virtua";
import {
  REVIEW_LIST_BUFFER_PX,
  REVIEW_LIST_ESTIMATED_ITEM_SIZE,
} from "../constants";
import type { ResolvedDiffSource } from "../utils/resolveDiffSource";
import { PendingReviewBar } from "./PendingReviewBar";
import { ReviewToolbar } from "./ReviewToolbar";

export function splitFilePath(fullPath: string): {
  dirPath: string;
  fileName: string;
} {
  const lastSlash = fullPath.lastIndexOf("/");
  return {
    dirPath: lastSlash >= 0 ? fullPath.slice(0, lastSlash + 1) : "",
    fileName: lastSlash >= 0 ? fullPath.slice(lastSlash + 1) : fullPath,
  };
}

export function sumHunkStats(hunks: FileDiffMetadata["hunks"]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    additions += hunk.additionLines;
    deletions += hunk.deletionLines;
  }
  return { additions, deletions };
}

export function buildItemIndex(
  items: { scrollKey?: string }[],
): Map<string, number> {
  const index = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    const key = items[i].scrollKey;
    if (key) index.set(key, i);
  }
  return index;
}

function workerFactory(): Worker {
  return new Worker(WorkerUrl, { type: "module" });
}

const STICKY_HEADER_CSS = `[data-diffs-header] { position: sticky; top: 0; z-index: 1; background: var(--gray-2); }`;

export type DeferredReason = "line-limit" | "unavailable";

function useDiffOptions() {
  const viewMode = useDiffViewerStore((s) => s.viewMode);
  const wordWrap = useDiffViewerStore((s) => s.wordWrap);
  const loadFullFiles = useDiffViewerStore((s) => s.loadFullFiles);
  const wordDiffs = useDiffViewerStore((s) => s.wordDiffs);
  const isDarkMode = useThemeStore((s) => s.isDarkMode);

  return useMemo(
    () => ({
      diffStyle: viewMode as "split" | "unified",
      overflow: (wordWrap ? "wrap" : "scroll") as "wrap" | "scroll",
      expandUnchanged: loadFullFiles,
      lineDiffType: (wordDiffs ? "word-alt" : "none") as "word-alt" | "none",
      themeType: (isDarkMode ? "dark" : "light") as "dark" | "light",
      theme: { dark: "github-dark" as const, light: "github-light" as const },
      unsafeCSS: STICKY_HEADER_CSS,
    }),
    [viewMode, wordWrap, loadFullFiles, wordDiffs, isDarkMode],
  );
}

export function useReviewState(
  changedFiles: ChangedFile[],
  allPaths: string[],
) {
  const diffOptions = useDiffOptions();

  const { linesAdded, linesRemoved } = useMemo(
    () => computeDiffStats(changedFiles),
    [changedFiles],
  );

  const collapseState = useCollapseState(allPaths);

  return { diffOptions, linesAdded, linesRemoved, ...collapseState };
}

function useCollapseState(filePaths: string[]) {
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleFile = useCallback((filePath: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, []);

  const uncollapseFile = useCallback((filePath: string) => {
    setCollapsedFiles((prev) => {
      if (!prev.has(filePath)) return prev;
      const next = new Set(prev);
      next.delete(filePath);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setCollapsedFiles(new Set()), []);

  const collapseAll = useCallback(
    () => setCollapsedFiles(new Set(filePaths)),
    [filePaths],
  );

  return {
    collapsedFiles,
    toggleFile,
    uncollapseFile,
    expandAll,
    collapseAll,
  };
}

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 500;
const SIDEBAR_DEFAULT_WIDTH = 280;

function ExpandedSidebar({ task }: { task: Task }) {
  const taskId = task.id;
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
        <ChangesPanel taskId={taskId} task={task} />
      </Flex>
    </Flex>
  );
}

export interface ReviewShellProps {
  task: Task;
  fileCount: number;
  linesAdded: number;
  linesRemoved: number;
  isLoading: boolean;
  isEmpty: boolean;
  items: ReviewListItem[];
  itemIndexByFilePath: Map<string, number>;
  onUncollapseFile?: (filePath: string) => void;
  allExpanded: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onRefresh?: () => void;
  effectiveSource?: ResolvedDiffSource;
  branchSourceAvailable?: boolean;
  prSourceAvailable?: boolean;
  defaultBranch?: string | null;
}

export interface ReviewListItem {
  key: string;
  scrollKey?: string;
  node: ReactNode;
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
  const taskId = task.id;
  const listRef = useRef<VListHandle | null>(null);

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

export function FileHeaderRow({
  dirPath,
  fileName,
  additions,
  deletions,
  collapsed,
  onToggle,
  trailing,
}: {
  dirPath: string;
  fileName: string;
  additions: number;
  deletions: number;
  collapsed: boolean;
  onToggle: () => void;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full cursor-pointer items-center gap-[6px] border-0 border-b border-b-(--gray-5) bg-transparent px-[12px] py-[6px] text-left font-[var(--code-font-family)] text-xs"
    >
      <CaretDown
        size={12}
        color="var(--gray-9)"
        style={{
          transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
          transition: "transform 0.15s",
        }}
        className="shrink-0"
      />
      <FileIcon filename={fileName} size={14} />
      <span
        title={dirPath + fileName}
        className="flex min-w-0 flex-1 gap-[6px]"
      >
        <span className="shrink-0 whitespace-nowrap font-semibold">
          {fileName}
        </span>
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-(--gray-9)">
          {dirPath}
        </span>
      </span>
      <span className="font-mono text-[10px]">
        {additions > 0 && (
          <span className="mr-[2px] text-(--green-9)">+{additions}</span>
        )}
        {deletions > 0 && <span className="text-(--red-9)">-{deletions}</span>}
      </span>
      {trailing}
    </button>
  );
}

export function DiffFileHeader({
  fileDiff,
  collapsed,
  onToggle,
  onOpenFile,
}: {
  fileDiff: FileDiffMetadata;
  collapsed: boolean;
  onToggle: () => void;
  onOpenFile?: () => void;
}) {
  const fullPath =
    fileDiff.prevName && fileDiff.prevName !== fileDiff.name
      ? `${fileDiff.prevName} \u2192 ${fileDiff.name}`
      : fileDiff.name;
  const { dirPath, fileName } = splitFilePath(fullPath ?? "");
  const { additions, deletions } = sumHunkStats(fileDiff.hunks);

  return (
    <FileHeaderRow
      dirPath={dirPath}
      fileName={fileName}
      additions={additions}
      deletions={deletions}
      collapsed={collapsed}
      onToggle={onToggle}
      trailing={
        onOpenFile && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFile();
            }}
            className="ml-auto inline-flex cursor-pointer rounded-[3px] border-0 bg-transparent p-[2px] text-(--gray-9) hover:bg-gray-4"
          >
            <ArrowSquareOut size={14} />
          </button>
        )
      }
    />
  );
}

function getDeferredMessage(reason: DeferredReason): string {
  switch (reason) {
    case "line-limit":
      return "File exceeds the 5,000-line review limit.";
    case "unavailable":
      return "Unable to load diff.";
  }
}

export function DeferredDiffPlaceholder({
  filePath,
  linesAdded,
  linesRemoved,
  reason,
  collapsed,
  onToggle,
  onShow,
  externalUrl,
}: {
  filePath: string;
  linesAdded: number;
  linesRemoved: number;
  reason: DeferredReason;
  collapsed: boolean;
  onToggle: () => void;
  onShow?: () => void;
  externalUrl?: string;
}) {
  const { dirPath, fileName } = splitFilePath(filePath);

  return (
    <div>
      <FileHeaderRow
        dirPath={dirPath}
        fileName={fileName}
        additions={linesAdded}
        deletions={linesRemoved}
        collapsed={collapsed}
        onToggle={onToggle}
      />
      {!collapsed && (
        <div className="w-full border-b border-b-(--gray-5) bg-(--gray-2) p-[16px] text-center text-(--gray-9) text-xs">
          {getDeferredMessage(reason)}
          {onShow ? (
            <>
              {" "}
              <button
                type="button"
                onClick={onShow}
                style={{
                  fontSize: "inherit",
                }}
                className="cursor-pointer border-0 bg-transparent p-0 text-(--accent-9) underline"
              >
                Load diff
              </button>
            </>
          ) : externalUrl ? (
            <>
              {" "}
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: "inherit",
                }}
                className="text-(--accent-9) underline"
              >
                View on GitHub
              </a>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
