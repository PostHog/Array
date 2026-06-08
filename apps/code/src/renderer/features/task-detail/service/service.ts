import { getAuthenticatedClient } from "@features/auth/hooks/authClient";
import { assertCloudUsageAvailable } from "@features/billing/preflightCloudUsage";
import { useDraftStore } from "@features/message-editor/stores/draftStore";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { workspaceApi } from "@features/workspace/hooks/useWorkspace";
import type { Workspace } from "@main/services/workspace/schemas";
import type { SagaResult } from "@posthog/shared";
import { CLOUD_USAGE_LIMIT_ERROR_MESSAGE } from "@renderer/api/posthogClient";
import {
  type TaskCreationInput,
  type TaskCreationOutput,
  TaskCreationSaga,
} from "@renderer/sagas/task/task-creation";
import { trpc } from "@renderer/trpc";
import { logger } from "@utils/logger";
import { queryClient } from "@utils/queryClient";
import { injectable } from "inversify";

export type { TaskCreationInput, TaskCreationOutput };

const log = logger.scope("task-service");

export type CreateTaskResult = SagaResult<TaskCreationOutput>;

/**
 * True when a failed createTask was blocked by the usage limit. The upgrade modal is
 * already shown in this case, so callers should suppress their own error toast.
 */
export function isUsageLimitResult(result: CreateTaskResult): boolean {
  return (
    !result.success &&
    (result.failedStep === "usage_limit" ||
      result.error === CLOUD_USAGE_LIMIT_ERROR_MESSAGE)
  );
}

@injectable()
export class TaskService {
  /**
   * Create a task with workspace provisioning.
   *
   * This method:
   * 2. Executes the TaskCreationSaga (with automatic rollback on failure)
   * 3. Updates renderer stores on success
   * 4. Returns a typed result for the hook to handle UI effects
   */
  public async createTask(
    input: TaskCreationInput,
    onTaskReady?: (output: TaskCreationOutput) => void,
    options?: { skipCloudUsagePreflight?: boolean },
  ): Promise<CreateTaskResult> {
    log.info("Creating task", {
      workspaceMode: input.workspaceMode,
      hasContent: !!input.content,
      hasRepo: !!input.repository,
    });

    if (!input.content?.trim()) {
      return {
        success: false,
        error: "Task description cannot be empty",
        failedStep: "validation",
      };
    }

    const posthogClient = await getAuthenticatedClient();
    if (!posthogClient) {
      return {
        success: false,
        error: "Not authenticated",
        failedStep: "validation",
      };
    }

    // Backstop for callers that bypass useTaskCreation (e.g. inbox); the helper shows the modal.
    // Callers that already pre-flighted pass skipCloudUsagePreflight to avoid a second fetch.
    if (
      !options?.skipCloudUsagePreflight &&
      input.workspaceMode === "cloud" &&
      !(await assertCloudUsageAvailable())
    ) {
      return {
        success: false,
        error: CLOUD_USAGE_LIMIT_ERROR_MESSAGE,
        failedStep: "usage_limit",
      };
    }

    const saga = new TaskCreationSaga({
      posthogClient,
      onTaskReady: onTaskReady
        ? (output) => {
            this.optimisticallyUpdateWorkspaceCache(output);
            this.updateStoresOnSuccess(output, input);
            void queryClient.invalidateQueries(
              trpc.workspace.getAll.pathFilter(),
            );
            onTaskReady(output);
          }
        : undefined,
    });

    const result = await saga.run(input);

    if (result.success) {
      this.optimisticallyUpdateWorkspaceCache(result.data);
      if (!onTaskReady) {
        this.updateStoresOnSuccess(result.data, input);
      }
      void queryClient.invalidateQueries(trpc.workspace.getAll.pathFilter());
    }

    return result;
  }

  /**
   * Open an existing task by ID, optionally loading a specific run.
   * If the workspace already exists, just fetches task data.
   * Otherwise runs the full saga to set up the workspace.
   */
  public async openTask(
    taskId: string,
    taskRunId?: string,
  ): Promise<CreateTaskResult> {
    log.info("Opening existing task", { taskId, taskRunId });

    const posthogClient = await getAuthenticatedClient();
    if (!posthogClient) {
      return {
        success: false,
        error: "Not authenticated",
        failedStep: "validation",
      };
    }

    const existingWorkspace = await workspaceApi.get(taskId);
    if (existingWorkspace) {
      log.info("Workspace already exists, fetching task only", { taskId });
      try {
        const task = await posthogClient.getTask(taskId);

        // If a specific run was requested, fetch and use it
        if (taskRunId) {
          log.info("Fetching specific task run", { taskId, taskRunId });
          const run = await posthogClient.getTaskRun(taskId, taskRunId);
          task.latest_run = run;
        }

        return {
          success: true,
          data: {
            task: task as unknown as import("@shared/types").Task,
            workspace: existingWorkspace,
          },
        };
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to fetch task",
          failedStep: "fetch_task",
        };
      }
    }

    // No existing workspace - run full saga to set it up
    const saga = new TaskCreationSaga({ posthogClient });
    const result = await saga.run({ taskId });

    if (result.success) {
      this.optimisticallyUpdateWorkspaceCache(result.data);
      this.updateStoresOnSuccess(result.data);
      void queryClient.invalidateQueries(trpc.workspace.getAll.pathFilter());

      // If a specific run was requested, update the task with that run
      if (taskRunId && result.data.task) {
        try {
          log.info("Fetching specific task run for new workspace", {
            taskId,
            taskRunId,
          });
          const run = await posthogClient.getTaskRun(taskId, taskRunId);
          result.data.task.latest_run = run;
        } catch (error) {
          log.warn("Failed to fetch specific task run, using latest", {
            taskId,
            taskRunId,
            error,
          });
        }
      }
    }

    return result;
  }

  private optimisticallyUpdateWorkspaceCache(output: TaskCreationOutput): void {
    if (!output.workspace) return;
    const workspace = output.workspace;
    queryClient.setQueriesData<Record<string, Workspace>>(
      trpc.workspace.getAll.pathFilter(),
      (old) => ({ ...old, [output.task.id]: workspace }),
    );
  }

  /**
   * Batch update stores after successful task creation/open.
   */
  private updateStoresOnSuccess(
    output: TaskCreationOutput,
    input?: TaskCreationInput,
  ): void {
    const settings = useSettingsStore.getState();
    const draftStore = useDraftStore.getState();

    const workspaceMode =
      input?.workspaceMode ?? output.workspace?.mode ?? "local";

    if (input) {
      settings.setLastUsedWorkspaceMode(workspaceMode);

      if (workspaceMode === "cloud") {
        settings.setLastUsedRunMode("cloud");
      } else {
        settings.setLastUsedRunMode("local");
        settings.setLastUsedLocalWorkspaceMode(
          workspaceMode as "worktree" | "local",
        );
      }

      draftStore.actions.setDraft("task-input", null);
    }
  }
}
