import type { Task } from "@posthog/shared/domain-types";
import { Box, Flex, Text, Tooltip } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys, useHotkeysContext } from "react-hotkeys-hook";
import { useBlurOnEscape } from "../../../hooks/useBlurOnEscape";
import { useSetHeaderContent } from "../../../hooks/useSetHeaderContent";
import { logger } from "../../../shell/logger";
import { ChannelBreadcrumb } from "../../canvas/components/ChannelBreadcrumb";
import { CloudReviewPage } from "../../code-review/components/CloudReviewPage";
import { ReviewPage } from "../../code-review/components/ReviewPage";
import { useReviewNavigationStore } from "../../code-review/reviewNavigationStore";
import { FilePicker } from "../../command/FilePicker";
import { useRepoFileWatcher } from "../../file-watcher/useRepoFileWatcher";
import { clearGitReviewQueries } from "../../git-interaction/gitCacheKeys";
import { PanelLayout } from "../../panels/components/PanelLayout";
import { usePanelLayoutStore } from "../../panels/panelLayoutStore";
import { getLeafPanel, parseTabId } from "../../panels/panelStoreHelpers";
import { MIN_CHAT_WIDTH } from "../../sessions/constants";
import { useCwd } from "../../sidebar/useCwd";
import { useRenameTask } from "../../tasks/useTaskMutations";
import { useWorkspace } from "../../workspace/useWorkspace";
import { useWorkspaceEvents } from "../../workspace/useWorkspaceEvents";
import { HeaderTitleEditor } from "../HeaderTitleEditor";
import { useTaskData } from "../hooks/useTaskData";
import { ExternalAppsOpener } from "./ExternalAppsOpener";
import { WorkspaceModeBadge } from "./WorkspaceModeBadge";

const MIN_REVIEW_WIDTH = 300;
const log = logger.scope("task-detail");

interface TaskDetailProps {
  task: Task;
  /**
   * When the task is opened inside a channel, the channel name to prefix the
   * header title with as a "# channel / title" breadcrumb. Omitted for the
   * plain Code task view.
   */
  channelName?: string;
}

export function TaskDetail({
  task: initialTask,
  channelName,
}: TaskDetailProps) {
  const taskId = initialTask.id;

  const { task } = useTaskData({ taskId, initialTask });

  const effectiveRepoPath = useCwd(taskId);

  const activeRelativePath = usePanelLayoutStore((state) => {
    const layout = state.getLayout(taskId);
    if (!layout) return null;

    const panelId = layout.focusedPanelId;
    if (!panelId) return null;

    const panel = getLeafPanel(layout.panelTree, panelId);
    if (!panel) return null;

    const parsed = parseTabId(panel.content.activeTabId);
    if (parsed.type === "file") {
      return parsed.value;
    }
    return null;
  });

  const openTargetPath =
    activeRelativePath && effectiveRepoPath
      ? [effectiveRepoPath, activeRelativePath].join("/").replace(/\/+/g, "/")
      : effectiveRepoPath;

  const [filePickerOpen, setFilePickerOpen] = useState(false);

  const { enableScope, disableScope } = useHotkeysContext();

  useEffect(() => {
    enableScope("taskDetail");
    return () => {
      disableScope("taskDetail");
    };
  }, [enableScope, disableScope]);

  useHotkeys("mod+p", () => setFilePickerOpen(true), {
    enableOnContentEditable: true,
    enableOnFormTags: true,
    preventDefault: true,
  });

  useRepoFileWatcher(effectiveRepoPath ?? null, taskId);

  useBlurOnEscape();
  useWorkspaceEvents(taskId);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const { renameTask } = useRenameTask();

  const handleTitleEditSubmit = useCallback(
    async (newTitle: string) => {
      setIsEditingTitle(false);

      try {
        await renameTask({
          taskId,
          currentTitle: task.title,
          newTitle,
        });
      } catch (error) {
        log.error("Failed to rename task", error);
      }
    },
    [renameTask, task.title, taskId],
  );

  const handleTitleEditCancel = useCallback(() => {
    setIsEditingTitle(false);
  }, []);
  const trailing = openTargetPath ? (
    <ExternalAppsOpener targetPath={openTargetPath} />
  ) : null;
  const workspace = useWorkspace(taskId);
  const workspaceMode = workspace?.mode;
  const headerContent = useMemo(
    () =>
      // Inside a channel, prefix the editable title with the channel
      // breadcrumb ("# channel / title"); the plain Code view keeps the bare
      // title. Both share the same inline-rename editor.
      channelName ? (
        <ChannelBreadcrumb
          channelName={channelName}
          leafIcon={
            workspaceMode ? (
              <WorkspaceModeBadge mode={workspaceMode} />
            ) : undefined
          }
          leafLabel={task.title}
          onRename={handleTitleEditSubmit}
          trailing={trailing}
        />
      ) : (
        <Flex align="center" justify="between" gap="2" width="100%">
          {isEditingTitle ? (
            <HeaderTitleEditor
              initialTitle={task.title}
              onSubmit={handleTitleEditSubmit}
              onCancel={handleTitleEditCancel}
            />
          ) : (
            <Flex align="center" gap="2" minWidth="0">
              <WorkspaceModeBadge mode={workspaceMode} />
              <Tooltip content={task.title} side="bottom" delayDuration={300}>
                <Text
                  truncate
                  className="no-drag min-w-0 font-medium text-[13px]"
                  onDoubleClick={() => setIsEditingTitle(true)}
                >
                  {task.title}
                </Text>
              </Tooltip>
            </Flex>
          )}
          {trailing}
        </Flex>
      ),
    [
      channelName,
      task.title,
      trailing,
      isEditingTitle,
      workspaceMode,
      handleTitleEditSubmit,
      handleTitleEditCancel,
    ],
  );

  useSetHeaderContent(headerContent);

  const reviewMode = useReviewNavigationStore(
    (s) => s.reviewModes[taskId] ?? "closed",
  );
  const isCloud =
    workspace?.mode === "cloud" || task.latest_run?.environment === "cloud";

  const isReviewOpen = reviewMode !== "closed";
  const isExpanded = reviewMode === "expanded";

  useEffect(() => {
    if (isReviewOpen) return;
    clearGitReviewQueries();
  }, [isReviewOpen]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [reviewWidth, setReviewWidth] = useState<number | null>(null);
  const isDragging = useRef(false);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;

      const startX = e.clientX;
      const container = containerRef.current;
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const startWidth = reviewWidth ?? containerRect.width * 0.5;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = startX - moveEvent.clientX;
        const maxWidth = Math.max(
          MIN_REVIEW_WIDTH,
          containerRect.width * 0.5,
          containerRect.width - MIN_CHAT_WIDTH,
        );
        const newWidth = Math.min(
          maxWidth,
          Math.max(MIN_REVIEW_WIDTH, startWidth + delta),
        );
        setReviewWidth(newWidth);
      };

      const onMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [reviewWidth],
  );

  return (
    <Box height="100%" ref={containerRef}>
      <Flex height="100%">
        <Box className={`min-w-0 flex-1 ${isExpanded ? "hidden" : ""}`}>
          <PanelLayout taskId={taskId} task={task} />
        </Box>

        {isReviewOpen && !isExpanded && (
          <Box
            onMouseDown={handleResizeStart}
            className="z-[1] w-[4px] shrink-0 cursor-col-resize border-l border-l-(--gray-6) bg-transparent transition-colors hover:bg-accent-6 active:bg-accent-8"
          />
        )}

        {isReviewOpen && (
          <Box
            style={{
              flex: isExpanded ? 1 : undefined,
              width: isExpanded
                ? undefined
                : reviewWidth
                  ? `${reviewWidth}px`
                  : "50%",
              minWidth: `${MIN_REVIEW_WIDTH}px`,
            }}
            className="h-full"
          >
            {isCloud ? (
              <CloudReviewPage task={task} />
            ) : (
              <ReviewPage task={task} />
            )}
          </Box>
        )}
      </Flex>
      <FilePicker
        open={filePickerOpen}
        onOpenChange={setFilePickerOpen}
        taskId={taskId}
        repoPath={effectiveRepoPath}
      />
    </Box>
  );
}
