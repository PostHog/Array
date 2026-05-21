import { useReviewNavigationStore } from "@features/code-review/stores/reviewNavigationStore";
import { useFolders } from "@features/folders/hooks/useFolders";
import { usePanelLayoutStore } from "@features/panels/store/panelLayoutStore";
import { getSessionService } from "@features/sessions/service/service";
import { useSettingsDialogStore } from "@features/settings/stores/settingsDialogStore";
import { useSidebarData } from "@features/sidebar/hooks/useSidebarData";
import { useVisualTaskOrder } from "@features/sidebar/hooks/useVisualTaskOrder";
import { useSidebarStore } from "@features/sidebar/stores/sidebarStore";
import { useTasks } from "@features/tasks/hooks/useTasks";
import { useFocusWorkspace } from "@features/workspace/hooks/useFocusWorkspace";
import { useWorkspaces } from "@features/workspace/hooks/useWorkspace";
import { SHORTCUTS } from "@renderer/constants/keyboard-shortcuts";
import { useTRPC } from "@renderer/trpc";
import type { Task } from "@shared/types";
import { useCommandMenuStore } from "@stores/commandMenuStore";
import { useNavigationStore } from "@stores/navigationStore";
import { useSubscription } from "@trpc/tanstack-react-query";
import { clearApplicationStorage } from "@utils/clearStorage";
import { logger } from "@utils/logger";
import { useCallback, useEffect, useMemo } from "react";
import { useHotkeys } from "react-hotkeys-hook";

interface GlobalEventHandlersProps {
  onToggleCommandMenu: () => void;
  onToggleShortcutsSheet: () => void;
}

export function GlobalEventHandlers({
  onToggleCommandMenu,
  onToggleShortcutsSheet,
}: GlobalEventHandlersProps) {
  const trpcReact = useTRPC();
  const commandMenuOpen = useCommandMenuStore((s) => s.isOpen);
  const openSettingsDialog = useSettingsDialogStore((state) => state.open);
  const navigateToTaskInput = useNavigationStore(
    (state) => state.navigateToTaskInput,
  );
  const navigateToTask = useNavigationStore((state) => state.navigateToTask);
  const navigateToInbox = useNavigationStore((state) => state.navigateToInbox);
  const navigateToFolderSettings = useNavigationStore(
    (state) => state.navigateToFolderSettings,
  );
  const view = useNavigationStore((state) => state.view);
  const goBack = useNavigationStore((state) => state.goBack);
  const goForward = useNavigationStore((state) => state.goForward);
  const { folders, loadFolders } = useFolders();
  const { data: workspaces = {} } = useWorkspaces();
  const clearAllLayouts = usePanelLayoutStore((state) => state.clearAllLayouts);
  const toggleLeftSidebar = useSidebarStore((state) => state.toggle);
  const setReviewMode = useReviewNavigationStore(
    (state) => state.setReviewMode,
  );
  const getReviewMode = useReviewNavigationStore(
    (state) => state.getReviewMode,
  );

  const currentTaskId = view.type === "task-detail" ? view.data?.id : undefined;
  const { workspace: currentWorkspace, handleToggleFocus } = useFocusWorkspace(
    currentTaskId ?? "",
  );
  const isWorktreeTask = currentWorkspace?.mode === "worktree";

  const { data: allTasks = [] } = useTasks();
  const sidebarData = useSidebarData({ activeView: view });
  const visualTaskOrder = useVisualTaskOrder(sidebarData);

  const taskById = useMemo(() => {
    const map = new Map<string, Task>();
    for (const task of allTasks) {
      map.set(task.id, task);
    }
    return map;
  }, [allTasks]);

  const handleSwitchTask = useCallback(
    (index: number) => {
      const taskData = visualTaskOrder[index - 1];
      const task = taskData ? taskById.get(taskData.id) : undefined;
      if (task) {
        navigateToTask(task);
      }
    },
    [visualTaskOrder, taskById, navigateToTask],
  );

  const handlePrevTask = useCallback(() => {
    if (visualTaskOrder.length === 0) return;
    if (view.type !== "task-detail" || !view.data) {
      const lastTaskData = visualTaskOrder[visualTaskOrder.length - 1];
      const task = lastTaskData ? taskById.get(lastTaskData.id) : undefined;
      if (task) navigateToTask(task);
      return;
    }
    const currentIndex = visualTaskOrder.findIndex(
      (t) => t.id === view.data?.id,
    );
    const prevIndex =
      currentIndex <= 0 ? visualTaskOrder.length - 1 : currentIndex - 1;
    const prevTaskData = visualTaskOrder[prevIndex];
    const task = prevTaskData ? taskById.get(prevTaskData.id) : undefined;
    if (task) navigateToTask(task);
  }, [visualTaskOrder, taskById, navigateToTask, view]);

  const handleNextTask = useCallback(() => {
    if (visualTaskOrder.length === 0) return;
    if (view.type !== "task-detail" || !view.data) {
      const firstTaskData = visualTaskOrder[0];
      const task = firstTaskData ? taskById.get(firstTaskData.id) : undefined;
      if (task) navigateToTask(task);
      return;
    }
    const currentIndex = visualTaskOrder.findIndex(
      (t) => t.id === view.data?.id,
    );
    const nextIndex =
      currentIndex >= visualTaskOrder.length - 1 ? 0 : currentIndex + 1;
    const nextTaskData = visualTaskOrder[nextIndex];
    const task = nextTaskData ? taskById.get(nextTaskData.id) : undefined;
    if (task) navigateToTask(task);
  }, [visualTaskOrder, taskById, navigateToTask, view]);

  const handleOpenSettings = useCallback(() => {
    openSettingsDialog();
  }, [openSettingsDialog]);

  const handleFocusTaskMode = useCallback(
    (data?: unknown) => {
      if (!data) return;
      navigateToTaskInput();
    },
    [navigateToTaskInput],
  );

  const handleResetLayout = useCallback(
    (data?: unknown) => {
      if (!data) return;
      clearAllLayouts();
      window.location.reload();
    },
    [clearAllLayouts],
  );

  const handleClearStorage = useCallback((data?: unknown) => {
    if (!data) return;
    clearApplicationStorage();
  }, []);

  const handleInvalidateToken = useCallback((data?: unknown) => {
    if (!data) return;
    const log = logger.scope("global-event-handlers");
    log.info("Main access token invalidated for testing");
  }, []);

  const globalOptions = {
    enableOnFormTags: true,
    enableOnContentEditable: true,
    preventDefault: true,
  } as const;

  useHotkeys(SHORTCUTS.COMMAND_MENU, onToggleCommandMenu, {
    ...globalOptions,
    enabled: !commandMenuOpen,
  });
  useHotkeys(SHORTCUTS.NEW_TASK, handleFocusTaskMode, globalOptions);
  useHotkeys(SHORTCUTS.SETTINGS, handleOpenSettings, globalOptions);
  useHotkeys(SHORTCUTS.GO_BACK, goBack, globalOptions);
  useHotkeys(SHORTCUTS.GO_FORWARD, goForward, globalOptions);
  const handleToggleReview = useCallback(() => {
    if (!currentTaskId) return;
    const mode = getReviewMode(currentTaskId);
    setReviewMode(currentTaskId, mode === "closed" ? "split" : "closed");
  }, [currentTaskId, getReviewMode, setReviewMode]);

  useHotkeys(SHORTCUTS.TOGGLE_LEFT_SIDEBAR, toggleLeftSidebar, globalOptions);
  useHotkeys(SHORTCUTS.TOGGLE_REVIEW_PANEL, handleToggleReview, globalOptions);
  useHotkeys(SHORTCUTS.SHORTCUTS_SHEET, onToggleShortcutsSheet, globalOptions);
  useHotkeys(SHORTCUTS.INBOX, navigateToInbox, globalOptions);
  useHotkeys(SHORTCUTS.PREV_TASK, handlePrevTask, globalOptions, [
    handlePrevTask,
  ]);
  useHotkeys(SHORTCUTS.NEXT_TASK, handleNextTask, globalOptions, [
    handleNextTask,
  ]);

  useHotkeys(
    SHORTCUTS.TOGGLE_FOCUS,
    handleToggleFocus,
    {
      ...globalOptions,
      enabled: !!currentTaskId && isWorktreeTask,
    },
    [handleToggleFocus],
  );

  // Task switching with mod+1-9
  useHotkeys(
    SHORTCUTS.SWITCH_TASK,
    (event, handler) => {
      if (event.ctrlKey && !event.metaKey) return;

      const keyPressed = handler.keys?.[0];
      if (!keyPressed) return;
      const index = parseInt(keyPressed, 10);
      handleSwitchTask(index);
    },
    globalOptions,
    [handleSwitchTask],
  );

  // Mouse back/forward buttons
  useEffect(() => {
    const handleMouseButton = (event: MouseEvent) => {
      if (event.button === 3) {
        event.preventDefault();
        goBack();
      } else if (event.button === 4) {
        event.preventDefault();
        goForward();
      }
    };

    window.addEventListener("mouseup", handleMouseButton);
    return () => {
      window.removeEventListener("mouseup", handleMouseButton);
    };
  }, [goBack, goForward]);

  useEffect(() => {
    const handleFocus = () => {
      loadFolders();
      getSessionService().retryUnhealthyCloudSessions();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadFolders]);

  // Check if current task's folder became invalid (e.g., moved while app was open)
  useEffect(() => {
    if (view.type !== "task-detail" || !view.data) return;

    const workspace = workspaces[view.data.id];
    if (!workspace?.folderId) return;

    const folder = folders.find((f) => f.id === workspace.folderId);
    if (folder && folder.exists === false) {
      navigateToFolderSettings(folder.id);
    }
  }, [view, folders, workspaces, navigateToFolderSettings]);

  useSubscription(
    trpcReact.ui.onOpenSettings.subscriptionOptions(undefined, {
      onData: handleOpenSettings,
    }),
  );

  useSubscription(
    trpcReact.ui.onNewTask.subscriptionOptions(undefined, {
      onData: handleFocusTaskMode,
    }),
  );

  useSubscription(
    trpcReact.ui.onResetLayout.subscriptionOptions(undefined, {
      onData: handleResetLayout,
    }),
  );

  useSubscription(
    trpcReact.ui.onClearStorage.subscriptionOptions(undefined, {
      onData: handleClearStorage,
    }),
  );

  useSubscription(
    trpcReact.ui.onInvalidateToken.subscriptionOptions(undefined, {
      onData: handleInvalidateToken,
    }),
  );

  return null;
}
