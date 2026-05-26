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
import { buildCreatePrReportPrompt } from "../utils/buildCreatePrReportPrompt";
import { resolveDefaultModel } from "../utils/resolveDefaultModel";

const log = logger.scope("create-pr-report");

interface UseCreatePrReportOptions {
  reportId: string;
  reportTitle: string | null;
  cloudRepository: string | null;
}

interface UseCreatePrReportReturn {
  /** Create an auto-mode implementation task for the report and navigate to it on success. */
  createPrReport: () => Promise<void>;
  /** True while the task is being created. */
  isCreatingPr: boolean;
}

/**
 * Create an implementation (PR) task directly from the inbox detail pane.
 *
 * Mirrors the Discuss flow: bypasses TaskInput so the user stays on the inbox
 * until the task is ready, then jumps straight to the task detail page. The
 * agent gets a short prompt that points it at the inbox MCP tools instead of
 * inlining the entire report summary.
 */
export function useCreatePrReport({
  reportId,
  reportTitle,
  cloudRepository,
}: UseCreatePrReportOptions): UseCreatePrReportReturn {
  const [isCreatingPr, setIsCreatingPr] = useState(false);
  const { navigateToTask } = useNavigationStore();
  const { getUserIntegrationIdForRepo } = useUserRepositoryIntegration();
  const { invalidateTasks } = useCreateTask();
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);

  const createPrReport = useCallback(async () => {
    if (isCreatingPr) return;
    if (!cloudRepository) {
      toast.error("Pick a cloud repository before creating a PR");
      return;
    }

    const githubUserIntegrationId =
      getUserIntegrationIdForRepo(cloudRepository);
    if (!githubUserIntegrationId) {
      toast.error("Connect a GitHub integration to create a PR");
      return;
    }

    if (!cloudRegion) {
      toast.error("Sign in to create a PR");
      return;
    }

    setIsCreatingPr(true);
    const toastId = toast.loading(
      "Starting PR task...",
      reportTitle ?? undefined,
    );

    const prompt = buildCreatePrReportPrompt({
      reportId,
      isDevBuild: import.meta.env.DEV,
    });

    const settings = useSettingsStore.getState();
    const adapter = settings.lastUsedAdapter ?? "claude";
    const apiHost = getCloudUrlFromRegion(cloudRegion);

    const model =
      settings.lastUsedModel ?? (await resolveDefaultModel(apiHost, adapter));

    if (!model) {
      sonnerToast.dismiss(toastId);
      toast.error("Failed to start PR task", {
        description:
          "Couldn't resolve a default model. Open the task page once and pick a model, then try again.",
      });
      setIsCreatingPr(false);
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
          adapter,
        });
      } else {
        sonnerToast.dismiss(toastId);
        toast.error("Failed to start PR task", {
          description: result.error,
        });
        log.error("Create PR task creation failed", {
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
      toast.error("Failed to start PR task", { description });
      log.error("Unexpected error during Create PR task creation", {
        error,
        reportId,
      });
    } finally {
      setIsCreatingPr(false);
    }
  }, [
    isCreatingPr,
    cloudRepository,
    cloudRegion,
    reportId,
    reportTitle,
    getUserIntegrationIdForRepo,
    invalidateTasks,
    navigateToTask,
  ]);

  return { createPrReport, isCreatingPr };
}
