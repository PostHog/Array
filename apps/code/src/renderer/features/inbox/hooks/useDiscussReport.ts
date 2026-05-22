import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { useSettingsStore } from "@features/settings/stores/settingsStore";
import { useCreateTask } from "@features/tasks/hooks/useTasks";
import { useUserRepositoryIntegration } from "@hooks/useIntegrations";
import { get } from "@renderer/di/container";
import { RENDERER_TOKENS } from "@renderer/di/tokens";
import { toast } from "@renderer/utils/toast";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { useNavigationStore } from "@stores/navigationStore";
import { track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { useCallback, useState } from "react";
import { toast as sonnerToast } from "sonner";
import type {
  TaskCreationInput,
  TaskService,
} from "../../task-detail/service/service";
import { buildDiscussReportPrompt } from "../utils/buildDiscussReportPrompt";
import { resolveDefaultModel } from "../utils/resolveDefaultModel";

const log = logger.scope("discuss-report");

interface UseDiscussReportOptions {
  reportId: string;
  reportTitle: string | null;
  cloudRepository: string | null;
}

interface UseDiscussReportReturn {
  /** Create a Discuss task for the report and navigate to it on success. */
  discussReport: (question?: string) => Promise<void>;
  /** True while a Discuss task is being created. */
  isDiscussing: boolean;
}

/**
 * Create a Discuss task directly from the inbox detail pane.
 *
 * Bypasses TaskInput entirely so the user stays on the inbox until the task is
 * ready, then jumps straight to the task detail page. On failure we surface a
 * toast and stay put.
 */
export function useDiscussReport({
  reportId,
  reportTitle,
  cloudRepository,
}: UseDiscussReportOptions): UseDiscussReportReturn {
  const [isDiscussing, setIsDiscussing] = useState(false);
  const { navigateToTask } = useNavigationStore();
  const { getUserIntegrationIdForRepo } = useUserRepositoryIntegration();
  const { invalidateTasks } = useCreateTask();
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);

  const discussReport = useCallback(
    async (question?: string) => {
      if (isDiscussing) return;
      if (!cloudRepository) {
        toast.error("Pick a cloud repository before starting a discussion");
        return;
      }

      const githubUserIntegrationId =
        getUserIntegrationIdForRepo(cloudRepository);
      if (!githubUserIntegrationId) {
        toast.error("Connect a GitHub integration to start a discussion");
        return;
      }

      if (!cloudRegion) {
        toast.error("Sign in to start a discussion");
        return;
      }

      setIsDiscussing(true);
      const toastId = toast.loading(
        "Starting discussion...",
        reportTitle ?? undefined,
      );

      const prompt = buildDiscussReportPrompt({
        reportId,
        reportTitle,
        question,
        isDevBuild: import.meta.env.DEV,
      });

      const settings = useSettingsStore.getState();
      const adapter = settings.lastUsedAdapter ?? "claude";
      const apiHost = getCloudUrlFromRegion(cloudRegion);

      const model =
        settings.lastUsedModel ?? (await resolveDefaultModel(apiHost, adapter));

      if (!model) {
        sonnerToast.dismiss(toastId);
        toast.error("Failed to start discussion", {
          description:
            "Couldn't resolve a default model. Open the task page once and pick a model, then try again.",
        });
        setIsDiscussing(false);
        return;
      }

      const input: TaskCreationInput = {
        content: prompt,
        taskDescription: prompt,
        repository: cloudRepository,
        githubUserIntegrationId,
        workspaceMode: "cloud",
        executionMode: "auto",
        adapter,
        model,
        reasoningLevel: settings.lastUsedReasoningEffort ?? undefined,
        cloudPrAuthorshipMode: "user",
        cloudRunSource: "signal_report",
        signalReportId: reportId,
      };

      try {
        const taskService = get<TaskService>(RENDERER_TOKENS.TaskService);
        const result = await taskService.createTask(input, (output) => {
          invalidateTasks(output.task);
          navigateToTask(output.task);
        });

        if (result.success) {
          sonnerToast.dismiss(toastId);
          track(ANALYTICS_EVENTS.TASK_CREATED, {
            auto_run: true,
            created_from: "command-menu",
            repository_provider: "github",
            workspace_mode: "cloud",
            has_branch: false,
            cloud_run_source: "signal_report",
            cloud_pr_authorship_mode: "user",
            signal_report_id: reportId,
            adapter,
          });
        } else {
          sonnerToast.dismiss(toastId);
          toast.error("Failed to start discussion", {
            description: result.error,
          });
          log.error("Discuss task creation failed", {
            failedStep: result.failedStep,
            error: result.error,
            reportId,
            reportTitle,
          });
        }
      } catch (error) {
        sonnerToast.dismiss(toastId);
        const description =
          error instanceof Error ? error.message : "Unknown error";
        toast.error("Failed to start discussion", { description });
        log.error("Unexpected error during Discuss task creation", {
          error,
          reportId,
        });
      } finally {
        setIsDiscussing(false);
      }
    },
    [
      isDiscussing,
      cloudRepository,
      cloudRegion,
      reportId,
      reportTitle,
      getUserIntegrationIdForRepo,
      invalidateTasks,
      navigateToTask,
    ],
  );

  return { discussReport, isDiscussing };
}
