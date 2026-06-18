import {
  getErrorTitle,
  prepareTaskInput,
} from "@posthog/core/task-detail/taskInput";
import {
  isUsageLimitResult,
  TASK_SERVICE,
  type TaskService,
} from "@posthog/core/task-detail/taskService";
import { useService } from "@posthog/di/react";
import type { HostTrpcClient } from "@posthog/host-router/client";
import { useHostTRPC, useHostTRPCClient } from "@posthog/host-router/react";
import {
  ANALYTICS_EVENTS,
  type TaskCreationInput,
  type WorkspaceMode,
} from "@posthog/shared";
import type { ExecutionMode, Task } from "@posthog/shared/domain-types";
import { useTaskInputPrefillStore } from "@posthog/ui/features/task-detail/stores/taskInputPrefillStore";
import { navigateToTaskPending } from "@posthog/ui/router/navigationBridge";
import { openTask, openTaskInput } from "@posthog/ui/router/useOpenTask";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useConnectivity } from "../../../hooks/useConnectivity";
import { toast } from "../../../primitives/toast";
import { track } from "../../../shell/analytics";
import { logger } from "../../../shell/logger";
import { pendingTaskPromptStoreApi } from "../../../shell/pendingTaskPromptStore";
import { useAuthStateValue } from "../../auth/store";
import { assertCloudUsageAvailable } from "../../billing/preflightCloudUsage";
import { useUsageLimitStore } from "../../billing/usageLimitStore";
import {
  contentToPlainText,
  contentToXml,
  type EditorContent,
  extractFilePaths,
} from "../../message-editor/content";
import { useTaskInputHistoryStore } from "../../message-editor/taskInputHistoryStore";
import type { EditorHandle } from "../../message-editor/types";
import { useSettingsStore } from "../../settings/settingsStore";
import { useCreateTask } from "../../tasks/useTaskCrudMutations";
import { useTourStore } from "../../tour/tourStore";
import { createFirstTaskTour } from "../../tour/tours/createFirstTaskTour";
import { useRemoteBranchConfirmStore } from "../stores/remoteBranchConfirmStore";

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
  channelContext?: string;
  channelName?: string;
  onTaskCreated?: (task: Task) => void;
}

interface UseTaskCreationReturn {
  isCreatingTask: boolean;
  canSubmit: boolean;
  handleSubmit: (contentOverride?: EditorContent) => Promise<boolean>;
  additionalDirectories: string[];
  setAdditionalDirectories: (next: string[]) => void;
}

async function trackTaskCreated(
  input: TaskCreationInput,
  selectedDirectory: string,
  hostClient: HostTrpcClient,
): Promise<void> {
  try {
    const workspaceMode = input.workspaceMode ?? "local";

    let usesWorktreeLink: boolean | undefined;
    let usesWorktreeInclude: boolean | undefined;
    if (workspaceMode === "worktree" && selectedDirectory) {
      try {
        const usage = await hostClient.workspace.getWorktreeFileUsage.query({
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
  channelContext,
  channelName,
  onTaskCreated,
}: UseTaskCreationOptions): UseTaskCreationReturn {
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const hostClient = useHostTRPCClient();
  const trpc = useHostTRPC();
  const defaultAdditionalDirectoriesQuery = useQuery(
    trpc.additionalDirectories.listDefaults.queryOptions(),
  );
  const defaultAdditionalDirectories =
    defaultAdditionalDirectoriesQuery.data ?? [];
  const [additionalDirectoriesOverride, setAdditionalDirectoriesOverride] =
    useState<string[] | null>(null);
  const additionalDirectories =
    additionalDirectoriesOverride ?? defaultAdditionalDirectories;
  const taskService = useService<TaskService>(TASK_SERVICE);
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

      // If the chosen worktree branch only exists on the remote, confirm before
      // fetching and checking it out locally. Done before the pending view so
      // the dialog (and a cancel) don't leave a half-started task on screen.
      let allowRemoteBranchCheckout = false;
      if (workspaceMode === "worktree" && branch && selectedDirectory) {
        try {
          const { status } =
            await hostClient.workspace.checkWorktreeBranch.query({
              mainRepoPath: selectedDirectory,
              branch,
            });
          if (status === "remote-only") {
            const confirmed = await useRemoteBranchConfirmStore
              .getState()
              .confirm(branch);
            if (!confirmed) {
              return false;
            }
            allowRemoteBranchCheckout = true;
          }
        } catch (error) {
          log.warn("Failed to check worktree branch availability", { error });
        }
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

        const serializedContent = contentToXml(content).trim();
        const filePaths = extractFilePaths(content);
        const input = prepareTaskInput(serializedContent, filePaths, {
          selectedDirectory,
          selectedRepository,
          githubIntegrationId,
          githubUserIntegrationId,
          workspaceMode,
          branch,
          allowRemoteBranchCheckout,
          executionMode,
          adapter,
          model,
          reasoningLevel,
          environmentId,
          sandboxEnvironmentId,
          signalReportId,
          additionalDirectories,
          channelContext,
          channelName,
        });

        if (executionMode) {
          useSettingsStore.getState().setLastUsedInitialTaskMode(executionMode);
        }

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
          void trackTaskCreated(input, selectedDirectory, hostClient);
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
      channelContext,
      channelName,
      clearTaskInputReportAssociation,
      invalidateTasks,
      onTaskCreated,
      hostClient,
      taskService,
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
