import { SIGNAL_REPORT_TASK_SERVICE } from "@posthog/core/inbox/identifiers";
import type { SignalReportTaskService } from "@posthog/core/inbox/signalReportTaskService";
import { isUsageLimitResult } from "@posthog/core/task-detail/taskService";
import { useService } from "@posthog/di/react";
import { ANALYTICS_EVENTS } from "@posthog/shared";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { useUserRepositoryIntegration } from "@posthog/ui/features/integrations/useIntegrations";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { useCreateTask } from "@posthog/ui/features/tasks/useTaskCrudMutations";
import { toast } from "@posthog/ui/primitives/toast";
import { openTask } from "@posthog/ui/router/useOpenTask";
import { track } from "@posthog/ui/shell/analytics";
import { logger } from "@posthog/ui/shell/logger";
import { useCallback, useState } from "react";
import { toast as sonnerToast } from "sonner";
import { useSignalTeamConfig } from "./useSignalTeamConfig";

const log = logger.scope("create-pr-report");

interface UseCreatePrReportOptions {
  reportId: string;
  reportTitle: string | null;
  cloudRepository: string | null;
}

interface UseCreatePrReportReturn {
  /**
   * Create an auto-mode implementation task for the report and navigate to it on success.
   * Optional `feedback` is folded into the agent prompt, e.g. to answer questions raised
   * in the report thread.
   */
  createPrReport: (feedback?: string) => Promise<void>;
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
  const { getUserIntegrationIdForRepo } = useUserRepositoryIntegration();
  const { invalidateTasks } = useCreateTask();
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);
  const { data: teamConfig } = useSignalTeamConfig();
  const service = useService<SignalReportTaskService>(
    SIGNAL_REPORT_TASK_SERVICE,
  );

  const createPrReport = useCallback(
    async (feedback?: string) => {
      if (isCreatingPr) return;
      setIsCreatingPr(true);
      const toastId = toast.loading(
        "Starting PR task...",
        reportTitle ?? undefined,
      );
      const settings = useSettingsStore.getState();
      const adapter = settings.lastUsedAdapter ?? "claude";

      const baseBranchOverrides = teamConfig?.autostart_base_branches ?? {};
      const targetRepo = cloudRepository?.toLowerCase();
      const baseBranch =
        targetRepo != null
          ? (Object.entries(baseBranchOverrides).find(
              ([repo]) => repo.toLowerCase() === targetRepo,
            )?.[1] ?? null)
          : null;

      const result = await service.createSignalReportTask(
        {
          kind: "create-pr",
          reportId,
          reportTitle,
          cloudRepository,
          githubUserIntegrationId: cloudRepository
            ? (getUserIntegrationIdForRepo(cloudRepository) ?? null)
            : null,
          cloudRegion,
          adapter,
          modelOverride: settings.lastUsedModel,
          reasoningLevel: settings.lastUsedReasoningEffort ?? undefined,
          baseBranch,
          isDevBuild: import.meta.env.DEV,
          feedback,
        },
        (output) => {
          invalidateTasks(output.task);
          void openTask(output.task);
        },
      );

      sonnerToast.dismiss(toastId);
      setIsCreatingPr(false);

      switch (result.status) {
        case "created":
          track(ANALYTICS_EVENTS.TASK_CREATED, {
            auto_run: true,
            created_from: "command-menu",
            repository_provider: "github",
            workspace_mode: "cloud",
            has_branch: baseBranch != null,
            cloud_run_source: "signal_report",
            cloud_pr_authorship_mode: "user",
            signal_report_id: reportId,
            adapter,
          });
          return;
        case "missing-repository":
          toast.error("Pick a cloud repository before creating a PR");
          return;
        case "missing-integration":
          toast.error("Connect a GitHub integration to create a PR");
          return;
        case "not-authenticated":
          toast.error("Sign in to create a PR");
          return;
        case "missing-model":
          toast.error("Failed to start PR task", {
            description:
              "Couldn't resolve a default model. Open the task page once and pick a model, then try again.",
          });
          return;
        case "create-failed":
          // Usage-limit blocks already show the upgrade modal; don't also toast an error.
          if (
            !isUsageLimitResult({
              success: false,
              error: result.error ?? "",
              failedStep: result.failedStep ?? "",
            })
          ) {
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
          return;
        case "errored":
          toast.error("Failed to start PR task", { description: result.error });
          log.error("Unexpected error during Create PR task creation", {
            error: result.error,
            reportId,
          });
          return;
      }
    },
    [
      isCreatingPr,
      cloudRepository,
      cloudRegion,
      reportId,
      reportTitle,
      getUserIntegrationIdForRepo,
      invalidateTasks,
      service,
      teamConfig,
    ],
  );

  return { createPrReport, isCreatingPr };
}
