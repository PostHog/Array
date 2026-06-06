import { DotsCircleSpinner } from "@components/DotsCircleSpinner";
import { useCommandCenterStore } from "@features/command-center/stores/commandCenterStore";
import { useInboxReports } from "@features/inbox/hooks/useInboxReports";
import { isReportUpForReview } from "@features/inbox/utils/filterReports";
import {
  INBOX_PIPELINE_STATUS_FILTER,
  INBOX_REFETCH_INTERVAL_MS,
} from "@features/inbox/utils/inboxConstants";
import {
  archiveTasksImperative,
  useArchiveTask,
} from "@features/tasks/hooks/useArchiveTask";
import { useRenameTask, useTasks } from "@features/tasks/hooks/useTasks";
import { useWorkspaces } from "@features/workspace/hooks/useWorkspace";
import { useAppView } from "@hooks/useAppView";
import { openTask, openTaskInput } from "@hooks/useOpenTask";
import { useTaskContextMenu } from "@hooks/useTaskContextMenu";
import { Separator } from "@posthog/quill";
import { Box, Flex } from "@radix-ui/themes";
import {
  navigateToCommandCenter,
  navigateToInbox,
  navigateToMcpServers,
  navigateToSkills,
  navigateToTaskDetail,
} from "@renderer/navigationBridge";
import { trpcClient } from "@renderer/trpc/client";
import type { Task } from "@shared/types";
import { useCommandMenuStore } from "@stores/commandMenuStore";
import { useRendererWindowFocusStore } from "@stores/rendererWindowFocusStore";
import { useQueryClient } from "@tanstack/react-query";
import { logger } from "@utils/logger";
import { toast } from "@utils/toast";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { usePinnedTasks } from "../hooks/usePinnedTasks";
import { useSidebarData } from "../hooks/useSidebarData";
import { useTaskViewed } from "../hooks/useTaskViewed";
import { useSidebarStore } from "../stores/sidebarStore";
import { useTaskSelectionStore } from "../stores/taskSelectionStore";
import { CommandCenterItem } from "./items/CommandCenterItem";
import { InboxItem, NewTaskItem } from "./items/HomeItem";
import { McpServersItem } from "./items/McpServersItem";
import { SearchItem } from "./items/SearchItem";
import { SkillsItem } from "./items/SkillsItem";
import { SidebarItem } from "./SidebarItem";
import { TaskListView } from "./TaskListView";
import { TasksHeader } from "./TasksHeader";

const log = logger.scope("sidebar-menu");

function SidebarMenuComponent() {
  const view = useAppView();

  // Must mirror useSidebarData's filters so taskMap covers every rendered
  // task — otherwise handleTaskClick silently bails for tasks not in the map.
  const showAllUsers = useSidebarStore((s) => s.showAllUsers);
  const showInternal = useSidebarStore((s) => s.showInternal);
  const { data: allTasks = [] } = useTasks({ showAllUsers, showInternal });

  const { data: workspaces = {} } = useWorkspaces();
  const { markAsViewed } = useTaskViewed();

  const { showContextMenu, editingTaskId, setEditingTaskId } =
    useTaskContextMenu();
  const { archiveTask } = useArchiveTask();
  const { renameTask } = useRenameTask();
  const { togglePin } = usePinnedTasks();

  const sidebarData = useSidebarData({
    activeView: view,
  });
  const inboxPollingActive = useRendererWindowFocusStore((s) => s.focused);
  const { data: inboxProbe } = useInboxReports(
    { status: INBOX_PIPELINE_STATUS_FILTER },
    {
      refetchInterval: inboxPollingActive ? INBOX_REFETCH_INTERVAL_MS : false,
      refetchIntervalInBackground: false,
      staleTime: inboxPollingActive ? INBOX_REFETCH_INTERVAL_MS : 15_000,
    },
  );
  const inboxResults = inboxProbe?.results ?? [];
  const inboxSignalCount = inboxResults.filter(isReportUpForReview).length;

  const taskMap = new Map<string, Task>();
  for (const task of allTasks) {
    taskMap.set(task.id, task);
  }

  const commandCenterCells = useCommandCenterStore((s) => s.cells);
  const assignTaskToCommandCenter = useCommandCenterStore((s) => s.assignTask);
  const commandCenterActiveCount = commandCenterCells.filter(
    (taskId) => taskId != null && taskMap.has(taskId),
  ).length;

  const previousTaskIdRef = useRef<string | null>(null);

  useEffect(() => {
    const currentTaskId =
      view.type === "task-detail" && view.taskId ? view.taskId : null;

    if (
      previousTaskIdRef.current &&
      previousTaskIdRef.current !== currentTaskId
    ) {
      markAsViewed(previousTaskIdRef.current);
    }

    if (currentTaskId) {
      markAsViewed(currentTaskId);
    }

    previousTaskIdRef.current = currentTaskId;
  }, [view, markAsViewed]);

  const handleNewTaskClick = () => {
    openTaskInput();
  };

  const handleInboxClick = () => {
    navigateToInbox();
  };

  const handleCommandCenterClick = () => {
    navigateToCommandCenter();
  };

  const handleSkillsClick = () => {
    navigateToSkills();
  };

  const handleMcpServersClick = () => {
    navigateToMcpServers();
  };

  const openCommandMenu = useCommandMenuStore((s) => s.open);
  const handleSearchClick = () => {
    openCommandMenu();
  };

  const queryClient = useQueryClient();

  const selectedTaskIds = useTaskSelectionStore((s) => s.selectedTaskIds);
  const toggleTaskSelection = useTaskSelectionStore(
    (s) => s.toggleTaskSelection,
  );
  const selectRange = useTaskSelectionStore((s) => s.selectRange);
  const clearSelection = useTaskSelectionStore((s) => s.clearSelection);
  const pruneSelection = useTaskSelectionStore((s) => s.pruneSelection);

  const organizeMode = useSidebarStore((s) => s.organizeMode);
  const collapsedSections = useSidebarStore((s) => s.collapsedSections);

  const allSidebarTasks = useMemo(
    () => [...sidebarData.pinnedTasks, ...sidebarData.flatTasks],
    [sidebarData.pinnedTasks, sidebarData.flatTasks],
  );

  const allSidebarTaskIds = useMemo(
    () => allSidebarTasks.map((t) => t.id),
    [allSidebarTasks],
  );

  // Ordered list of currently visible task IDs in display order. Used as the
  // index for shift-click range selection so it matches what the user sees —
  // in by-project mode the chronological flat order would span across project
  // groups and pull in unrelated tasks.
  const orderedVisibleTaskIds = useMemo(() => {
    const ids: string[] = sidebarData.pinnedTasks.map((t) => t.id);
    if (organizeMode === "by-project") {
      for (const group of sidebarData.groupedTasks) {
        if (collapsedSections.has(group.id)) continue;
        for (const t of group.tasks) ids.push(t.id);
      }
    } else {
      for (const t of sidebarData.flatTasks) ids.push(t.id);
    }
    return ids;
  }, [
    sidebarData.pinnedTasks,
    sidebarData.flatTasks,
    sidebarData.groupedTasks,
    organizeMode,
    collapsedSections,
  ]);

  useEffect(() => {
    pruneSelection(allSidebarTaskIds);
  }, [allSidebarTaskIds, pruneSelection]);

  // The active (routed) task is implicitly part of any bulk selection — the
  // user expects to see and act on it together with cmd/shift-clicked tasks.
  const activeTaskId = sidebarData.activeTaskId;
  const effectiveBulkIds = useMemo(() => {
    if (selectedTaskIds.length === 0) return [];
    if (!activeTaskId) return selectedTaskIds;
    if (selectedTaskIds.includes(activeTaskId)) return selectedTaskIds;
    return [activeTaskId, ...selectedTaskIds];
  }, [activeTaskId, selectedTaskIds]);

  const handleTaskClick = (taskId: string, e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.preventDefault();
      selectRange(taskId, orderedVisibleTaskIds, activeTaskId);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      toggleTaskSelection(taskId);
      return;
    }

    clearSelection();
    const task = taskMap.get(taskId);
    if (task) {
      void openTask(task);
    } else {
      // Sidebar rows come from the summaries path, which can include tasks the
      // full-list query (taskMap) doesn't carry. Don't silently bail — navigate
      // by id; the task-detail route resolves the task from its own query.
      navigateToTaskDetail(taskId);
    }
  };

  const handleBulkContextMenu = useCallback(
    async (e: React.MouseEvent, taskIds: string[]) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const result =
          await trpcClient.contextMenu.showBulkTaskContextMenu.mutate({
            taskCount: taskIds.length,
          });
        if (!result.action) return;
        if (result.action.type === "archive") {
          const { archived, failed } = await archiveTasksImperative(
            taskIds,
            queryClient,
          );
          clearSelection();
          if (failed === 0) {
            toast.success(
              `${archived} ${archived === 1 ? "task" : "tasks"} archived`,
            );
          } else {
            toast.error(`${archived} archived, ${failed} failed`);
          }
        }
      } catch (error) {
        log.error("Failed to show bulk context menu", error);
      }
    },
    [queryClient, clearSelection],
  );

  const handleTaskContextMenu = (
    taskId: string,
    e: React.MouseEvent,
    isPinned: boolean,
  ) => {
    // Bulk menu when 2+ tasks are in the effective selection (active + cmd/shift-clicked)
    // and the right-clicked task is one of them. Otherwise clear and fall through.
    if (effectiveBulkIds.length > 1) {
      if (effectiveBulkIds.includes(taskId)) {
        handleBulkContextMenu(e, effectiveBulkIds);
        return;
      }
      clearSelection();
    }

    const task = taskMap.get(taskId);
    if (task) {
      const workspace = workspaces[taskId];
      const taskData = allSidebarTasks.find((t) => t.id === taskId);
      const isInCommandCenter = commandCenterCells.some(
        (id) => id === taskId && taskMap.has(id),
      );
      const hasEmptyCommandCenterCell = commandCenterCells.some(
        (id) => id == null || !taskMap.has(id),
      );

      showContextMenu(task, e, {
        worktreePath: workspace?.worktreePath ?? undefined,
        folderPath: workspace?.folderPath ?? undefined,
        isPinned,
        isSuspended: taskData?.isSuspended,
        isInCommandCenter,
        hasEmptyCommandCenterCell,
        onTogglePin: () => togglePin(taskId),
        onArchivePrior: handleArchivePrior,
        onAddToCommandCenter: () => {
          const cells = useCommandCenterStore.getState().cells;
          const idx = cells.findIndex((id) => id == null || !taskMap.has(id));
          if (idx !== -1) {
            assignTaskToCommandCenter(idx, taskId);
            navigateToCommandCenter();
          } else {
            toast.info("Command center is full");
          }
        },
      });
    }
  };

  const handleTaskArchive = async (taskId: string) => {
    await archiveTask({ taskId });
  };

  const handleArchivePrior = useCallback(
    async (taskId: string) => {
      const allVisible = [...sidebarData.pinnedTasks, ...sidebarData.flatTasks];
      const clickedTask = allVisible.find((t) => t.id === taskId);
      if (!clickedTask) return;

      const threshold = clickedTask.createdAt;
      const priorTaskIds = allVisible
        .filter((t) => t.id !== taskId && t.createdAt < threshold)
        .map((t) => t.id);

      if (priorTaskIds.length === 0) {
        toast.info("No older tasks to archive");
        return;
      }

      const { archived, failed } = await archiveTasksImperative(
        priorTaskIds,
        queryClient,
      );

      if (failed === 0) {
        toast.success(
          `${archived} ${archived === 1 ? "task" : "tasks"} archived`,
        );
      } else {
        toast.error(`${archived} archived, ${failed} failed`);
      }
    },
    [sidebarData.pinnedTasks, sidebarData.flatTasks, queryClient],
  );
  const handleTaskDoubleClick = useCallback(
    (taskId: string) => {
      setEditingTaskId(taskId);
    },
    [setEditingTaskId],
  );

  const handleTaskEditSubmit = useCallback(
    async (taskId: string, currentTitle: string, newTitle: string) => {
      setEditingTaskId(null);

      try {
        await renameTask({
          taskId,
          currentTitle,
          newTitle,
        });
      } catch (error) {
        log.error("Failed to rename task", error);
      }
    },
    [renameTask, setEditingTaskId],
  );

  const handleTaskEditCancel = useCallback(() => {
    setEditingTaskId(null);
  }, [setEditingTaskId]);

  return (
    <Box
      height="100%"
      position="relative"
      id="side-bar-menu"
      className="flex min-h-0 flex-col"
    >
      <Flex direction="column" className="shrink-0 gap-px px-2 py-2">
        <Box mb="2">
          <NewTaskItem
            isActive={sidebarData.isHomeActive}
            onClick={handleNewTaskClick}
            variant="primary"
          />
        </Box>

        <Box>
          <SearchItem onClick={handleSearchClick} />
        </Box>

        <Box>
          <InboxItem
            isActive={sidebarData.isInboxActive}
            onClick={handleInboxClick}
            signalCount={inboxSignalCount}
          />
        </Box>

        <Box>
          <SkillsItem
            isActive={sidebarData.isSkillsActive}
            onClick={handleSkillsClick}
          />
        </Box>

        <Box>
          <McpServersItem
            isActive={sidebarData.isMcpServersActive}
            onClick={handleMcpServersClick}
          />
        </Box>

        <Box mb="2">
          <CommandCenterItem
            isActive={sidebarData.isCommandCenterActive}
            onClick={handleCommandCenterClick}
            activeCount={commandCenterActiveCount}
          />
        </Box>
      </Flex>

      <Separator className="mx-2 my-2 shrink-0" />

      <TasksHeader />

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <Flex direction="column" className="gap-px px-2 pb-2">
          {sidebarData.isLoading ? (
            <SidebarItem
              depth={0}
              icon={<DotsCircleSpinner size={12} className="text-gray-10" />}
              label="Loading tasks..."
              disabled
            />
          ) : (
            <TaskListView
              pinnedTasks={sidebarData.pinnedTasks}
              flatTasks={sidebarData.flatTasks}
              groupedTasks={sidebarData.groupedTasks}
              activeTaskId={sidebarData.activeTaskId}
              editingTaskId={editingTaskId}
              selectedTaskIds={effectiveBulkIds}
              onTaskClick={handleTaskClick}
              onTaskDoubleClick={handleTaskDoubleClick}
              onTaskContextMenu={handleTaskContextMenu}
              onTaskArchive={handleTaskArchive}
              onTaskTogglePin={togglePin}
              onTaskEditSubmit={handleTaskEditSubmit}
              onTaskEditCancel={handleTaskEditCancel}
              hasMore={sidebarData.hasMore}
            />
          )}
        </Flex>
      </div>
    </Box>
  );
}

export const SidebarMenu = memo(SidebarMenuComponent);
