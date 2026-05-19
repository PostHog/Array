import type { TaskService } from "@features/task-detail/service/service";
import { get as getFromContainer } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import type { Task } from "@shared/types";
import { logger } from "@utils/logger";
import { create } from "zustand";

const log = logger.scope("inbox-cloud-task-store");

interface RunCloudTaskParams {
  prompt: string;
  githubIntegrationId?: number;
  reportId?: string;
}

interface RunCloudTaskResult {
  success: boolean;
  task?: Task;
  error?: string;
}

interface InboxCloudTaskStoreState {
  isRunning: boolean;
  showConfirm: boolean;
  selectedRepo: string | null;
}

interface InboxCloudTaskStoreActions {
  openConfirm: (defaultRepo: string | null) => void;
  closeConfirm: () => void;
  setSelectedRepo: (repo: string | null) => void;
  runCloudTask: (params: RunCloudTaskParams) => Promise<RunCloudTaskResult>;
}

type InboxCloudTaskStore = InboxCloudTaskStoreState &
  InboxCloudTaskStoreActions;

export const useInboxCloudTaskStore = create<InboxCloudTaskStore>()(
  (set, get) => ({
    isRunning: false,
    showConfirm: false,
    selectedRepo: null,

    openConfirm: (defaultRepo) =>
      set({ showConfirm: true, selectedRepo: defaultRepo }),

    closeConfirm: () => set({ showConfirm: false }),

    setSelectedRepo: (repo) => set({ selectedRepo: repo }),

    runCloudTask: async (params) => {
      const { selectedRepo } = get();
      set({ showConfirm: false, isRunning: true });

      try {
        const taskService = getFromContainer<TaskService>(
          RENDERER_TOKENS.TaskService,
        );
        const result = await taskService.createTask({
          content: params.prompt,
          workspaceMode: "cloud",
          githubIntegrationId: params.githubIntegrationId,
          repository: selectedRepo,
          cloudPrAuthorshipMode: "bot",
          cloudRunSource: "signal_report",
          signalReportId: params.reportId,
        });

        if (result.success) {
          const { task } = result.data;
          log.info("Cloud task created from signal report", {
            taskId: task.id,
            reportId: params.reportId,
            repository: selectedRepo,
          });
          return { success: true, task };
        }

        log.error("Cloud task creation failed", {
          failedStep: result.failedStep,
          error: result.error,
        });
        return {
          success: false,
          error: result.error ?? "Failed to create cloud task",
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        log.error("Unexpected error during cloud task creation", { error });
        return {
          success: false,
          error: `Failed to run cloud task: ${message}`,
        };
      } finally {
        set({ isRunning: false });
      }
    },
  }),
);
