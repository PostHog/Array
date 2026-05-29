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
  const { getUserIntegrationIdForRepo } = useUserRepositoryIntegration();
  const { invalidateTasks } = useCreateTask();
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);
  const service = useService<SignalReportTaskService>(
    SIGNAL_REPORT_TASK_SERVICE,
  );

  const discussReport = useCallback(
    async (question?: string) => {
      if (isDiscussing) return;
      setIsDiscussing(true);
      const toastId = toast.loading(
        "Starting discussion...",
        reportTitle ?? undefined,
      );
      const settings = useSettingsStore.getState();
      const adapter = settings.lastUsedAdapter ?? "claude";

      const result = await service.createSignalReportTask(
        {
          kind: "discuss",
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
          question,
          isDevBuild: import.meta.env.DEV,
        },
        (output) => {
          invalidateTasks(output.task);
          void openTask(output.task);
        },
      );

      sonnerToast.dismiss(toastId);
      setIsDiscussing(false);

      switch (result.status) {
        case "created":
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
          return;
        case "missing-repository":
          toast.error("Pick a cloud repository before starting a discussion");
          return;
        case "missing-integration":
          toast.error("Connect a GitHub integration to start a discussion");
          return;
        case "not-authenticated":
          toast.error("Sign in to start a discussion");
          return;
        case "missing-model":
          toast.error("Failed to start discussion", {
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
          return;
        case "errored":
          toast.error("Failed to start discussion", {
            description: result.error,
          });
          log.error("Unexpected error during Discuss task creation", {
            error: result.error,
            reportId,
          });
          return;
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
      service,
    ],
  );

  return { discussReport, isDiscussing };
}
