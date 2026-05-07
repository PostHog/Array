import { DotsCircleSpinner } from "@components/DotsCircleSpinner";
import { useCommandCenterStore } from "@features/command-center/stores/commandCenterStore";
import { useInboxReports } from "@features/inbox/hooks/useInboxReports";
import { isReportUpForReview } from "@features/inbox/utils/filterReports";
import {
  INBOX_PIPELINE_STATUS_FILTER,
  INBOX_REFETCH_INTERVAL_MS,
} from "@features/inbox/utils/inboxConstants";
import { useOnboardingStore } from "@features/onboarding/stores/onboardingStore";
import { getSessionService } from "@features/sessions/service/service";
import { useSetupStore } from "@features/setup/stores/setupStore";
import {
  archiveTaskImperative,
  useArchiveTask,
} from "@features/tasks/hooks/useArchiveTask";
import { useTasks, useUpdateTask } from "@features/tasks/hooks/useTasks";
import { useWorkspaces } from "@features/workspace/hooks/useWorkspace";
import { useTaskContextMenu } from "@hooks/useTaskContextMenu";
import { ScrollArea, Separator } from "@posthog/quill";
import { Box, Flex } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { useNavigationStore } from "@stores/navigationStore";
import { useRendererWindowFocusStore } from "@stores/rendererWindowFocusStore";
import { useQueryClient } from "@tanstack/react-query";
import { logger } from "@utils/logger";
import { toast } from "@utils/toast";
import { memo, useCallback, useEffect, useRef } from "react";
import { usePinnedTasks } from "../hooks/usePinnedTasks";
import { useSidebarData } from "../hooks/useSidebarData";
import { useTaskViewed } from "../hooks/useTaskViewed";
import { CommandCenterItem } from "./items/CommandCenterItem";
import { InboxItem, NewTaskItem } from "./items/HomeItem";
import { McpServersItem } from "./items/McpServersItem";
import { SetupItem } from "./items/SetupItem";
import { SkillsItem } from "./items/SkillsItem";
import { SidebarItem } from "./SidebarItem";
import { TaskListView } from "./TaskListView";

function SidebarMenuComponent() {
  const {
    view,
    navigateToTask,
    navigateToTaskInput,
    navigateToInbox,
    navigateToCommandCenter,
    navigateToSkills,
    navigateToMcpServers,
    navigateToSetup,
  } = useNavigationStore();

  const { data: allTasks = [] } = useTasks();

  const { data: workspaces = {} } = useWorkspaces();
  const { markAsViewed } = useTaskViewed();

  const { showContextMenu, editingTaskId, setEditingTaskId } =
    useTaskContextMenu();
  const { archiveTask } = useArchiveTask();
  const { togglePin } = usePinnedTasks();

  const hasCompletedSetup = useOnboardingStore(
    (state) => state.hasCompletedSetup,
  );
  const showSetupItem = useSetupStore((s) => {
    if (!hasCompletedSetup) return true;
    if (s.discoveryStatus === "running") return true;
    if (s.discoveryStatus === "done" && s.discoveredTasks.length > 0)
      return true;
    return false;
  });

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
      view.type === "task-detail" && view.data ? view.data.id : null;

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
    navigateToTaskInput();
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

  const handleSetupClick = () => {
    navigateToSetup();
  };

  const handleTaskClick = (taskId: string) => {
    const task = taskMap.get(taskId);
    if (task) {
      navigateToTask(task);
    }
  };

  const allSidebarTasks = [
    ...sidebarData.pinnedTasks,
    ...sidebarData.flatTasks,
  ];

  const handleTaskContextMenu = (
    taskId: string,
    e: React.MouseEvent,
    isPinned: boolean,
  ) => {
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

  const updateTask = useUpdateTask();
  const queryClient = useQueryClient();

  const handleArchivePrior = useCallback(
    async (taskId: string) => {
      const allVisible = [...sidebarData.pinnedTasks, ...sidebarData.flatTasks];
      const clickedTask = allVisible.find((t) => t.id === taskId);
      if (!clickedTask) return;

      const sortKey = "createdAt" as const;
      const threshold = clickedTask[sortKey];
      const priorTaskIds = allVisible
        .filter((t) => t.id !== taskId && t[sortKey] < threshold)
        .map((t) => t.id);

      if (priorTaskIds.length === 0) {
        toast.info("No older tasks to archive");
        return;
      }

      const nav = useNavigationStore.getState();
      const priorSet = new Set(priorTaskIds);
      if (
        nav.view.type === "task-detail" &&
        nav.view.data &&
        priorSet.has(nav.view.data.id)
      ) {
        nav.navigateToTaskInput();
      }

      let done = 0;
      let failed = 0;
      for (const id of priorTaskIds) {
        try {
          await archiveTaskImperative(id, queryClient, {
            skipNavigate: true,
          });
          done++;
        } catch {
          failed++;
        }
      }

      if (failed === 0) {
        toast.success(`${done} ${done === 1 ? "task" : "tasks"} archived`);
      } else {
        toast.error(`${done} archived, ${failed} failed`);
      }
    },
    [sidebarData.pinnedTasks, sidebarData.flatTasks, queryClient],
  );
  const log = logger.scope("sidebar-menu");

  const handleTaskDoubleClick = useCallback(
    (taskId: string) => {
      setEditingTaskId(taskId);
    },
    [setEditingTaskId],
  );

  const handleTaskEditSubmit = useCallback(
    async (taskId: string, newTitle: string) => {
      setEditingTaskId(null);

      // Optimistically update task title in all cached task lists
      queryClient.setQueriesData<Task[]>(
        { queryKey: ["tasks", "list"] },
        (old) =>
          old?.map((task) =>
            task.id === taskId
              ? { ...task, title: newTitle, title_manually_set: true }
              : task,
          ),
      );

      // Sync to session store so notifications use the updated title
      getSessionService().updateSessionTaskTitle(taskId, newTitle);

      try {
        await updateTask.mutateAsync({
          taskId,
          updates: { title: newTitle, title_manually_set: true },
        });
      } catch (error) {
        log.error("Failed to rename task", error);
        // Refetch to revert optimistic update on failure
        queryClient.invalidateQueries({ queryKey: ["tasks", "list"] });
      }
    },
    [setEditingTaskId, updateTask, queryClient, log],
  );

  const handleTaskEditCancel = useCallback(() => {
    setEditingTaskId(null);
  }, [setEditingTaskId]);

  return (
    <Box height="100%" position="relative" id="side-bar-menu">
      <ScrollArea className="h-full overflow-y-auto overflow-x-hidden">
        <Flex direction="column" py="2" px="2" gap="1px">
          <Box mb="2">
            <NewTaskItem
              isActive={sidebarData.isHomeActive}
              onClick={handleNewTaskClick}
              variant="primary"
            />
          </Box>

          {showSetupItem && (
            <Box mb="1" px="1">
              <SetupItem
                isActive={sidebarData.isSetupActive}
                onClick={handleSetupClick}
              />
            </Box>
          )}

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

          <Separator className="mx-2 my-2" />

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
      </ScrollArea>
    </Box>
  );
}

export const SidebarMenu = memo(SidebarMenuComponent);
