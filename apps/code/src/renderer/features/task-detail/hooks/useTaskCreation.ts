import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { assertCloudUsageAvailable } from "@features/billing/preflightCloudUsage";
import { useUsageLimitStore } from "@features/billing/stores/usageLimitStore";
import { buildCloudTaskDescription } from "@features/editor/utils/cloud-prompt";
import { useTaskInputHistoryStore } from "@features/message-editor/stores/taskInputHistoryStore";
import type { EditorHandle } from "@features/message-editor/types";
import {
  contentToPlainText,
  contentToXml,
  type EditorContent,
  extractFilePaths,
} from "@features/message-editor/utils/content";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { useTaskInputPrefillStore } from "@features/task-detail/stores/taskInputPrefillStore";
import { useCreateTask } from "@features/tasks/hooks/useTasks";
import { useTourStore } from "@features/tour/stores/tourStore";
import { createFirstTaskTour } from "@features/tour/tours/createFirstTaskTour";
import { useConnectivity } from "@hooks/useConnectivity";
import { openTask, openTaskInput } from "@hooks/useOpenTask";
import type { WorkspaceMode } from "@main/services/workspace/schemas";
import { get } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import { navigateToTaskPending } from "@renderer/navigationBridge";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { toast } from "@renderer/utils/toast";
import type { ExecutionMode, Task } from "@shared/types";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { pendingTaskPromptStoreApi } from "@stores/pendingTaskPromptStore";
import { useQuery } from "@tanstack/react-query";
import { track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { useCallback, useState } from "react";
import {
  isUsageLimitResult,
  type TaskCreationInput,
  type TaskService,
} from "../service/service";

const log = logger.scope("task-creation");

interface UseTaskCreationOptions {
  editorRef: React.RefObject<EditorHandle | null>;
  selectedDirectory: string;
  selectedRepository?: string | null;
  githubIntegrationId?: number;
  githubUserIntegrationId?: string;
  workspaceMode: WorkspaceMode;
  branch?: string | null;
  editorIsEmpty: boolean;
  executionMode?: ExecutionMode;
  adapter?: "claude" | "codex";
  model?: string;
  reasoningLevel?: string;
  environmentId?: string | null;
  sandboxEnvironmentId?: string;
  signalReportId?: string;
  onTaskCreated?: (task: Task) => void;
}

interface UseTaskCreationReturn {
  isCreatingTask: boolean;
  canSubmit: boolean;
  handleSubmit: (contentOverride?: EditorContent) => Promise<boolean>;
  additionalDirectories: string[];
  setAdditionalDirectories: (next: string[]) => void;
}

function prepareTaskInput(
  content: Parameters<typeof contentToXml>[0],
  options: {
    selectedDirectory: string;
    selectedRepository?: string | null;
    githubIntegrationId?: number;
    githubUserIntegrationId?: string;
    workspaceMode: WorkspaceMode;
    branch?: string | null;
    executionMode?: ExecutionMode;
    adapter?: "claude" | "codex";
    model?: string;
    reasoningLevel?: string;
    environmentId?: string | null;
    sandboxEnvironmentId?: string;
    signalReportId?: string;
    additionalDirectories?: string[];
  },
): TaskCreationInput {
  const serializedContent = contentToXml(content).trim();
  const filePaths = extractFilePaths(content);

  return {
    content: serializedContent,
    taskDescription:
      options.workspaceMode === "cloud"
        ? buildCloudTaskDescription(serializedContent, filePaths)
        : undefined,
    filePaths,
    repoPath:
      options.workspaceMode === "cloud" ? undefined : options.selectedDirectory,
    repository:
      options.workspaceMode === "cloud"
        ? options.selectedRepository
        : undefined,
    githubIntegrationId: options.githubIntegrationId,
    githubUserIntegrationId: options.githubUserIntegrationId,
    workspaceMode: options.workspaceMode,
    branch: options.branch,
    executionMode: options.executionMode,
    adapter: options.adapter,
    model: options.model,
    reasoningLevel: options.reasoningLevel,
    environmentId: options.environmentId ?? undefined,
    sandboxEnvironmentId: options.sandboxEnvironmentId,
    cloudPrAuthorshipMode:
      options.signalReportId && options.workspaceMode === "cloud"
        ? "user"
        : undefined,
    cloudRunSource:
      options.signalReportId && options.workspaceMode === "cloud"
        ? "signal_report"
        : undefined,
    signalReportId: options.signalReportId,
    additionalDirectories:
      options.workspaceMode === "cloud"
        ? undefined
        : options.additionalDirectories,
  };
}

async function trackTaskCreated(
  input: TaskCreationInput,
  selectedDirectory: string,
): Promise<void> {
  try {
    const workspaceMode = input.workspaceMode ?? "local";

    let usesWorktreeLink: boolean | undefined;
    let usesWorktreeInclude: boolean | undefined;
    if (workspaceMode === "worktree" && selectedDirectory) {
      try {
        const usage = await trpcClient.workspace.getWorktreeFileUsage.query({
          mainRepoPath: selectedDirectory,
        });
        usesWorktreeLink = usage.usesWorktreeLink;
        usesWorktreeInclude = usage.usesWorktreeInclude;
      } catch (error) {
        log.warn("Failed to read worktree file usage for analytics", {
          error,
        });
      }
    }

    track(ANALYTICS_EVENTS.TASK_CREATED, {
      auto_run: !!input.executionMode,
      created_from: "command-menu",
      repository_provider: input.repository ? "github" : "none",
      workspace_mode: workspaceMode,
      has_branch: !!input.branch,
      has_environment_setup:
        workspaceMode === "worktree" ? !!input.environmentId : undefined,
      has_sandbox_environment:
        workspaceMode === "cloud" ? !!input.sandboxEnvironmentId : undefined,
      cloud_run_source:
        workspaceMode === "cloud"
          ? (input.cloudRunSource ?? "manual")
          : undefined,
      cloud_pr_authorship_mode:
        workspaceMode === "cloud" ? input.cloudPrAuthorshipMode : undefined,
      signal_report_id: input.signalReportId,
      uses_worktree_link: usesWorktreeLink,
      uses_worktree_include: usesWorktreeInclude,
      adapter: input.adapter,
    });
  } catch (error) {
    log.warn("Failed to track Task created event", { error });
  }
}

function getErrorTitle(failedStep: string): string {
  const titles: Record<string, string> = {
    repo_detection: "Failed to detect repository",
    task_creation: "Failed to create task",
    workspace_creation: "Failed to create workspace",
    cloud_prompt_preparation: "Failed to prepare cloud attachments",
    cloud_run: "Failed to start cloud execution",
    agent_session: "Failed to start agent session",
  };
  return titles[failedStep] ?? "Task creation failed";
}

export function useTaskCreation({
  editorRef,
  selectedDirectory,
  selectedRepository,
  githubIntegrationId,
  githubUserIntegrationId,
  workspaceMode,
  branch,
  editorIsEmpty,
  executionMode,
  adapter,
  model,
  reasoningLevel,
  environmentId,
  sandboxEnvironmentId,
  signalReportId,
  onTaskCreated,
}: UseTaskCreationOptions): UseTaskCreationReturn {
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const trpc = useTRPC();
  const defaultAdditionalDirectoriesQuery = useQuery(
    trpc.additionalDirectories.listDefaults.queryOptions(),
  );
  const defaultAdditionalDirectories =
    defaultAdditionalDirectoriesQuery.data ?? [];
  const [additionalDirectoriesOverride, setAdditionalDirectoriesOverride] =
    useState<string[] | null>(null);
  const additionalDirectories =
    additionalDirectoriesOverride ?? defaultAdditionalDirectories;
  const clearTaskInputReportAssociation = useTaskInputPrefillStore(
    (s) => s.clearReportAssociation,
  );
  const isAuthenticated = useAuthStateValue(
    (state) => state.status === "authenticated",
  );
  const { invalidateTasks } = useCreateTask();
  const { isOnline } = useConnectivity();

  const hasRequiredPath =
    workspaceMode === "cloud" ? !!selectedRepository : !!selectedDirectory;
  const canSubmitBase =
    isAuthenticated && isOnline && hasRequiredPath && !isCreatingTask;
  const canSubmit = !!editorRef.current && canSubmitBase && !editorIsEmpty;

  const handleSubmit = useCallback(
    async (contentOverride?: EditorContent): Promise<boolean> => {
      const editor = editorRef.current;
      if (!editor) return false;
      const allowSubmit = contentOverride ? canSubmitBase : canSubmit;
      if (!allowSubmit) return false;

      // Block over-limit cloud creation before the pending view so it doesn't flash.
      if (workspaceMode === "cloud" && !(await assertCloudUsageAvailable())) {
        return false;
      }

      setIsCreatingTask(true);

      const content = contentOverride ?? editor.getContent();
      const plainPromptText = contentToPlainText(content).trim();
      const shouldShowPendingView = !onTaskCreated && !!plainPromptText;
      const pendingTaskKey = shouldShowPendingView
        ? (globalThis.crypto?.randomUUID?.() ?? `pending-${Date.now()}`)
        : null;

      if (pendingTaskKey) {
        pendingTaskPromptStoreApi.set(pendingTaskKey, {
          promptText: plainPromptText,
          attachments: (content.attachments ?? []).map((a) => ({
            id: a.id,
            label: a.label,
          })),
        });
        navigateToTaskPending(pendingTaskKey);
        if (!contentOverride) {
          editor.clear();
        }
      }

      try {
        if (!contentOverride) {
          const plainText = editor.getText()?.trim() ?? plainPromptText;
          if (plainText) {
            useTaskInputHistoryStore.getState().addPrompt(plainText);
          }
        }

        const input = prepareTaskInput(content, {
          selectedDirectory,
          selectedRepository,
          githubIntegrationId,
          githubUserIntegrationId,
          workspaceMode,
          branch,
          executionMode,
          adapter,
          model,
          reasoningLevel,
          environmentId,
          sandboxEnvironmentId,
          signalReportId,
          additionalDirectories,
        });

        if (executionMode) {
          useSettingsStore.getState().setLastUsedInitialTaskMode(executionMode);
        }

        const taskService = get<TaskService>(RENDERER_TOKENS.TaskService);
        const result = await taskService.createTask(
          input,
          (output) => {
            invalidateTasks(output.task);
            if (signalReportId) {
              clearTaskInputReportAssociation();
            }
            if (pendingTaskKey) {
              pendingTaskPromptStoreApi.move(pendingTaskKey, output.task.id);
            }
            if (onTaskCreated) {
              onTaskCreated(output.task);
            } else {
              void openTask(output.task);
            }
            useTourStore.getState().completeTour(createFirstTaskTour.id);
            if (!pendingTaskKey && !contentOverride) {
              editor.clear();
            }
            // Pre-flight already ran above for cloud; skip the service's duplicate check.
          },
          { skipCloudUsagePreflight: true },
        );

        if (result.success) {
          setAdditionalDirectoriesOverride(null);
          void trackTaskCreated(input, selectedDirectory);
        }

        if (!result.success) {
          // Usage-limit blocks already show the upgrade modal; don't also toast an error.
          if (isUsageLimitResult(result)) {
            useUsageLimitStore.getState().show();
            log.warn("Cloud task creation blocked by usage limit");
          } else {
            const title = getErrorTitle(result.failedStep);
            toast.error(title, { description: result.error });
            log.error("Task creation failed", {
              failedStep: result.failedStep,
              error: result.error,
            });
          }
          if (pendingTaskKey) {
            pendingTaskPromptStoreApi.clear(pendingTaskKey);
            openTaskInput({ initialPrompt: plainPromptText });
          }
        }
        return result.success;
      } catch (error) {
        const description =
          error instanceof Error ? error.message : "Unknown error";
        toast.error("Failed to create task", { description });
        log.error("Unexpected error during task creation", { error });
        if (pendingTaskKey) {
          pendingTaskPromptStoreApi.clear(pendingTaskKey);
          openTaskInput({ initialPrompt: plainPromptText });
        }
        return false;
      } finally {
        setIsCreatingTask(false);
      }
    },
    [
      canSubmit,
      canSubmitBase,
      editorRef,
      selectedDirectory,
      selectedRepository,
      githubIntegrationId,
      githubUserIntegrationId,
      workspaceMode,
      branch,
      executionMode,
      adapter,
      model,
      reasoningLevel,
      environmentId,
      sandboxEnvironmentId,
      signalReportId,
      additionalDirectories,
      clearTaskInputReportAssociation,
      invalidateTasks,
      onTaskCreated,
    ],
  );

  return {
    isCreatingTask,
    canSubmit,
    handleSubmit,
    additionalDirectories,
    setAdditionalDirectories: setAdditionalDirectoriesOverride,
  };
}
