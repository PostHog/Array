import {
  REPORT_MODEL_RESOLVER,
  type ReportModelResolver,
} from "@posthog/core/inbox/identifiers";
import {
  isUsageLimitResult,
  TASK_SERVICE,
  type TaskCreationInput,
  type TaskService,
} from "@posthog/core/task-detail/taskService";
import { useService } from "@posthog/di/react";
import { ANALYTICS_EVENTS, getCloudUrlFromRegion } from "@posthog/shared";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { resolveDefaultModel } from "@posthog/ui/features/inbox/hooks/resolveDefaultModel";
import { useUserRepositoryIntegration } from "@posthog/ui/features/integrations/useIntegrations";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { useCreateTask } from "@posthog/ui/features/tasks/useTaskCrudMutations";
import { toast } from "@posthog/ui/primitives/toast";
import { openTask } from "@posthog/ui/router/useOpenTask";
import { track } from "@posthog/ui/shell/analytics";
import { logger } from "@posthog/ui/shell/logger";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast as sonnerToast } from "sonner";

/** Variant-specific copy used in the toasts/errors emitted by the runner. */
export interface InboxCloudTaskCopy {
  /** Toast shown while the task is being created. */
  loadingTitle: string;
  /** Toast title used for any failure (repo / integration / sign-in / mutation). */
  errorTitle: string;
  /** Error description when no repository is selected. */
  missingRepository: string;
  /** Error description when no GitHub integration is connected for the repo. */
  missingIntegration: string;
  /** Error description when the user is signed out. */
  signedOut: string;
  /** Error description when no model can be resolved. */
  missingModel: string;
}

/** Context the variant uses to assemble the TaskCreationInput. */
export interface InboxCloudTaskInputContext {
  reportId?: string;
  reportTitle?: string | null;
  cloudRepository: string;
  githubUserIntegrationId: string;
  adapter: "claude" | "codex";
  model: string;
  reasoningLevel?: string;
}

export interface UseInboxCloudTaskRunnerOptions {
  /** Backing signal report, when the task is report-scoped (Create PR, Discuss). */
  reportId?: string;
  reportTitle?: string | null;
  cloudRepository: string | null;
  copy: InboxCloudTaskCopy;
  /** Logger scope used for failure traces. */
  loggerScope: string;
  /** Build the TaskCreationInput from the resolved context (prompt, branch, etc.). */
  buildInput: (ctx: InboxCloudTaskInputContext) => TaskCreationInput;
  /** Telemetry extras merged into the TASK_CREATED event when the run succeeds. */
  analyticsExtras?: Record<string, unknown>;
}

export interface UseInboxCloudTaskRunnerReturn {
  /** Kick off the cloud-task flow. Resolves after the task is created (or failed). */
  run: () => Promise<void>;
  /** True while a task is being created. */
  isRunning: boolean;
}

/**
 * Shared driver for one-click "create an auto-mode cloud task" flows
 * (Create PR, Discuss, scout fleet overview). Variants supply copy, telemetry,
 * and a `buildInput` callback that assembles the per-variant prompt / branch /
 * metadata; report context is optional for flows not scoped to a report.
 */
export function useInboxCloudTaskRunner({
  reportId,
  reportTitle,
  cloudRepository,
  copy,
  loggerScope,
  buildInput,
  analyticsExtras,
}: UseInboxCloudTaskRunnerOptions): UseInboxCloudTaskRunnerReturn {
  const [isRunning, setIsRunning] = useState(false);
  const { getUserIntegrationIdForRepo } = useUserRepositoryIntegration();
  const { invalidateTasks } = useCreateTask();
  const taskService = useService<TaskService>(TASK_SERVICE);
  const modelResolver = useService<ReportModelResolver>(REPORT_MODEL_RESOLVER);
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);
  const queryClient = useQueryClient();

  const run = useCallback(async () => {
    if (isRunning) return;
    const log = logger.scope(loggerScope);

    if (!cloudRepository) {
      toast.error(copy.errorTitle, { description: copy.missingRepository });
      return;
    }

    const githubUserIntegrationId =
      getUserIntegrationIdForRepo(cloudRepository);
    if (!githubUserIntegrationId) {
      toast.error(copy.errorTitle, { description: copy.missingIntegration });
      return;
    }

    if (!cloudRegion) {
      toast.error(copy.errorTitle, { description: copy.signedOut });
      return;
    }

    setIsRunning(true);
    const toastId = toast.loading(copy.loadingTitle, reportTitle ?? undefined);

    const settings = useSettingsStore.getState();
    const adapter = settings.lastUsedAdapter ?? "claude";
    const apiHost = getCloudUrlFromRegion(cloudRegion);

    const model =
      settings.lastUsedModel ??
      (await resolveDefaultModel(queryClient, apiHost, adapter, modelResolver));

    if (!model) {
      sonnerToast.dismiss(toastId);
      toast.error(copy.errorTitle, { description: copy.missingModel });
      setIsRunning(false);
      return;
    }

    const input = buildInput({
      reportId,
      reportTitle,
      cloudRepository,
      githubUserIntegrationId: String(githubUserIntegrationId),
      adapter,
      model,
      reasoningLevel: settings.lastUsedReasoningEffort ?? undefined,
    });

    try {
      const result = await taskService.createTask(input, (output) => {
        invalidateTasks(output.task);
        void openTask(output.task);
      });

      if (result.success) {
        sonnerToast.dismiss(toastId);
        track(ANALYTICS_EVENTS.TASK_CREATED, {
          auto_run: true,
          created_from: "command-menu",
          repository_provider: "github",
          workspace_mode: "cloud",
          ...(reportId
            ? {
                cloud_run_source: "signal_report",
                cloud_pr_authorship_mode: "user",
                signal_report_id: reportId,
              }
            : { cloud_run_source: "manual" }),
          adapter,
          ...analyticsExtras,
        });
      } else {
        sonnerToast.dismiss(toastId);
        // Usage-limit blocks already show the upgrade modal; don't double-toast.
        if (!isUsageLimitResult(result)) {
          toast.error(copy.errorTitle, { description: result.error });
          log.error("Cloud-task creation failed", {
            failedStep: result.failedStep,
            error: result.error,
            reportId,
            reportTitle,
          });
        }
      }
    } catch (error) {
      sonnerToast.dismiss(toastId);
      const description =
        error instanceof Error ? error.message : "Unknown error";
      toast.error(copy.errorTitle, { description });
      log.error("Unexpected error during cloud-task creation", {
        error,
        reportId,
      });
    } finally {
      setIsRunning(false);
    }
  }, [
    isRunning,
    loggerScope,
    cloudRepository,
    cloudRegion,
    reportId,
    reportTitle,
    getUserIntegrationIdForRepo,
    invalidateTasks,
    queryClient,
    buildInput,
    copy,
    analyticsExtras,
    modelResolver,
    taskService,
  ]);

  return { run, isRunning };
}
