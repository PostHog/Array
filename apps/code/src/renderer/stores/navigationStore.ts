import { foldersApi } from "@features/folders/hooks/useFolders";
import { workspaceApi } from "@features/workspace/hooks/useWorkspace";
import { getTaskDirectory } from "@hooks/useRepositoryDirectory";
import type { Task } from "@shared/types";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { track } from "@utils/analytics";
import { electronStorage } from "@utils/electronStorage";
import { logger } from "@utils/logger";
import { getTaskRepository } from "@utils/repository";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const log = logger.scope("navigation-store");

type ViewType =
  | "task-detail"
  | "task-input"
  | "folder-settings"
  | "inbox"
  | "archived"
  | "command-center"
  | "skills"
  | "mcp-servers"
  | "setup";

export interface TaskInputReportAssociation {
  reportId: string;
  title: string;
}

interface TaskInputNavigationOptions {
  folderId?: string;
  initialPrompt?: string;
  initialCloudRepository?: string;
  reportAssociation?: TaskInputReportAssociation;
}

interface ViewState {
  type: ViewType;
  data?: Task;
  taskId?: string;
  folderId?: string;
  taskInputRequestId?: string;
  initialPrompt?: string;
  initialCloudRepository?: string;
  reportAssociation?: TaskInputReportAssociation;
}

interface NavigationStore {
  view: ViewState;
  history: ViewState[];
  historyIndex: number;
  taskInputReportAssociation?: TaskInputReportAssociation;
  taskInputCloudRepository?: string;
  navigateToTask: (task: Task) => void;
  navigateToTaskInput: (
    folderIdOrOptions?: string | TaskInputNavigationOptions,
  ) => void;
  clearTaskInputReportAssociation: () => void;
  navigateToFolderSettings: (folderId: string) => void;
  navigateToInbox: () => void;
  navigateToArchived: () => void;
  navigateToCommandCenter: () => void;
  navigateToSkills: () => void;
  navigateToMcpServers: () => void;
  navigateToSetup: () => void;
  goBack: () => void;
  goForward: () => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  hydrateTask: (tasks: Task[]) => void;
}

const isSameView = (view1: ViewState, view2: ViewState): boolean => {
  if (view1.type !== view2.type) return false;
  if (view1.type === "task-detail" && view2.type === "task-detail") {
    return view1.data?.id === view2.data?.id;
  }
  if (view1.type === "task-input" && view2.type === "task-input") {
    return (
      view1.folderId === view2.folderId &&
      view1.taskInputRequestId === view2.taskInputRequestId
    );
  }
  if (view1.type === "folder-settings" && view2.type === "folder-settings") {
    return view1.folderId === view2.folderId;
  }
  if (view1.type === "inbox" && view2.type === "inbox") {
    return true;
  }
  if (view1.type === "archived" && view2.type === "archived") {
    return true;
  }
  if (view1.type === "command-center" && view2.type === "command-center") {
    return true;
  }
  if (view1.type === "skills" && view2.type === "skills") {
    return true;
  }
  if (view1.type === "mcp-servers" && view2.type === "mcp-servers") {
    return true;
  }
  if (view1.type === "setup" && view2.type === "setup") {
    return true;
  }
  return false;
};

export const useNavigationStore = create<NavigationStore>()(
  persist(
    (set, get) => {
      const navigate = (newView: ViewState) => {
        const { view, history, historyIndex } = get();
        if (isSameView(view, newView)) {
          return;
        }
        const newHistory = [...history.slice(0, historyIndex + 1), newView];
        set({
          view: newView,
          history: newHistory,
          historyIndex: newHistory.length - 1,
        });
      };

      return {
        view: { type: "task-input" },
        history: [{ type: "task-input" }],
        historyIndex: 0,
        taskInputReportAssociation: undefined,
        taskInputCloudRepository: undefined,

        navigateToTask: async (task: Task) => {
          navigate({ type: "task-detail", data: task, taskId: task.id });
          track(ANALYTICS_EVENTS.TASK_VIEWED, {
            task_id: task.id,
          });

          const repoKey = getTaskRepository(task) ?? undefined;

          const existingWorkspace = await workspaceApi.get(task.id);
          if (existingWorkspace?.folderId) {
            const folders = await foldersApi.getFolders();
            const folder = folders.find(
              (f) => f.id === existingWorkspace.folderId,
            );

            if (folder && folder.exists === false) {
              log.info("Folder path is stale, redirecting to folder settings", {
                folderId: folder.id,
                path: folder.path,
              });
              navigate({ type: "folder-settings", folderId: folder.id });
              return;
            }

            if (folder) {
              return;
            }
          }

          const directory = await getTaskDirectory(
            task.id,
            repoKey ?? undefined,
          );

          if (directory) {
            try {
              await foldersApi.addFolder(directory);

              const workspaceMode =
                task.latest_run?.environment === "cloud" ? "cloud" : "local";

              await workspaceApi.create({
                taskId: task.id,
                mainRepoPath: directory,
                folderId: "",
                folderPath: directory,
                mode: workspaceMode,
              });
            } catch (error) {
              log.error("Failed to auto-register folder on task open:", error);
            }
          } else if (task.latest_run?.environment === "cloud") {
            await workspaceApi.create({
              taskId: task.id,
              mainRepoPath: "",
              folderId: "",
              folderPath: "",
              mode: "cloud",
            });
          }
        },

        navigateToTaskInput: (folderIdOrOptions) => {
          const options =
            typeof folderIdOrOptions === "string"
              ? { folderId: folderIdOrOptions }
              : (folderIdOrOptions ?? {});
          const hasTransientState =
            !!options.initialPrompt ||
            !!options.initialCloudRepository ||
            !!options.reportAssociation;
          if (options.reportAssociation || options.initialCloudRepository) {
            set({
              taskInputReportAssociation: options.reportAssociation,
              taskInputCloudRepository: options.initialCloudRepository,
            });
          }
          navigate({
            type: "task-input",
            folderId: options.folderId,
            initialPrompt: options.initialPrompt,
            initialCloudRepository: options.initialCloudRepository,
            reportAssociation: options.reportAssociation,
            taskInputRequestId: hasTransientState
              ? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`)
              : undefined,
          });
        },

        clearTaskInputReportAssociation: () => {
          const {
            view,
            history,
            historyIndex,
            taskInputReportAssociation,
            taskInputCloudRepository,
          } = get();
          if (
            !taskInputReportAssociation &&
            !view.reportAssociation &&
            !taskInputCloudRepository &&
            !view.initialCloudRepository
          ) {
            return;
          }

          const updatedView = {
            ...view,
            reportAssociation: undefined,
            initialCloudRepository: undefined,
          };
          const updatedHistory = [...history];
          if (updatedHistory[historyIndex]?.type === "task-input") {
            updatedHistory[historyIndex] = {
              ...updatedHistory[historyIndex],
              reportAssociation: undefined,
              initialCloudRepository: undefined,
            };
          }

          set({
            view: updatedView,
            history: updatedHistory,
            taskInputReportAssociation: undefined,
            taskInputCloudRepository: undefined,
          });
        },

        navigateToFolderSettings: (folderId: string) => {
          navigate({ type: "folder-settings", folderId });
        },

        navigateToInbox: () => {
          navigate({ type: "inbox" });
          track(ANALYTICS_EVENTS.TASK_VIEWED, {
            task_id: "inbox",
          });
        },

        navigateToArchived: () => {
          navigate({ type: "archived" });
        },

        navigateToCommandCenter: () => {
          navigate({ type: "command-center" });
          track(ANALYTICS_EVENTS.COMMAND_CENTER_VIEWED);
        },

        navigateToSkills: () => {
          navigate({ type: "skills" });
        },

        navigateToMcpServers: () => {
          navigate({ type: "mcp-servers" });
        },

        navigateToSetup: () => {
          navigate({ type: "setup" });
        },

        goBack: () => {
          const { history, historyIndex } = get();
          if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            set({
              view: history[newIndex],
              historyIndex: newIndex,
            });
          }
        },

        goForward: () => {
          const { history, historyIndex } = get();
          if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            set({
              view: history[newIndex],
              historyIndex: newIndex,
            });
          }
        },

        canGoBack: () => {
          const { historyIndex } = get();
          return historyIndex > 0;
        },

        canGoForward: () => {
          const { history, historyIndex } = get();
          return historyIndex < history.length - 1;
        },

        hydrateTask: (tasks: Task[]) => {
          const { view, navigateToTask, navigateToTaskInput } = get();
          if (view.type !== "task-detail" || !view.taskId || view.data) return;

          const task = tasks.find((t) => t.id === view.taskId);
          if (task) {
            navigateToTask(task);
          } else {
            navigateToTaskInput();
          }
        },
      };
    },
    {
      name: "navigation-storage",
      storage: electronStorage,
      partialize: (state) => ({
        view: {
          type: state.view.type,
          taskId: state.view.taskId,
          folderId: state.view.folderId,
        },
      }),
    },
  ),
);
