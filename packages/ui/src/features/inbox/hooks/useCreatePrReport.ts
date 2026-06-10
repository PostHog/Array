import { buildCreatePrReportPrompt } from "@posthog/core/inbox/reportActions";
import type { TaskCreationInput } from "@posthog/core/task-detail/taskService";
import {
  type InboxCloudTaskInputContext,
  useInboxCloudTaskRunner,
} from "@posthog/ui/features/inbox/hooks/useInboxCloudTaskRunner";
import { useSignalTeamConfig } from "@posthog/ui/features/inbox/hooks/useSignalTeamConfig";
import { useCallback, useMemo } from "react";

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
 * Bypasses TaskInput so the user stays on the inbox until the task is ready,
 * then jumps straight to the task detail page. The agent receives a short
 * prompt pointing it at the inbox MCP tools instead of inlining the report
 * summary. The base branch comes from the team-level autostart override map.
 */
export function useCreatePrReport({
  reportId,
  reportTitle,
  cloudRepository,
}: UseCreatePrReportOptions): UseCreatePrReportReturn {
  const { data: teamConfig } = useSignalTeamConfig();
  const baseBranchOverrides = teamConfig?.autostart_base_branches ?? null;

  const buildInput = useCallback(
    (ctx: InboxCloudTaskInputContext): TaskCreationInput => {
      const prompt = buildCreatePrReportPrompt({
        reportId: ctx.reportId,
        isDevBuild: import.meta.env.DEV,
      });
      const targetRepo = ctx.cloudRepository.toLowerCase();
      const baseBranch = baseBranchOverrides
        ? (Object.entries(baseBranchOverrides).find(
            ([repo]) => repo.toLowerCase() === targetRepo,
          )?.[1] ?? null)
        : null;
      return {
        content: prompt,
        taskDescription: prompt,
        repository: ctx.cloudRepository,
        githubUserIntegrationId: ctx.githubUserIntegrationId,
        workspaceMode: "cloud",
        executionMode: "auto",
        adapter: ctx.adapter,
        model: ctx.model,
        branch: baseBranch,
        reasoningLevel: ctx.reasoningLevel,
        cloudPrAuthorshipMode: "user",
        cloudRunSource: "signal_report",
        signalReportId: ctx.reportId,
      };
    },
    [baseBranchOverrides],
  );

  const analyticsExtras = useMemo(
    () => ({
      has_branch:
        baseBranchOverrides != null &&
        cloudRepository != null &&
        Object.keys(baseBranchOverrides).some(
          (repo) => repo.toLowerCase() === cloudRepository.toLowerCase(),
        ),
    }),
    [baseBranchOverrides, cloudRepository],
  );

  const { run, isRunning } = useInboxCloudTaskRunner({
    reportId,
    reportTitle,
    cloudRepository,
    loggerScope: "create-pr-report",
    copy: {
      loadingTitle: "Starting PR task...",
      errorTitle: "Failed to start PR task",
      missingRepository: "Pick a cloud repository before creating a PR",
      missingIntegration: "Connect a GitHub integration to create a PR",
      signedOut: "Sign in to create a PR",
      missingModel:
        "Couldn't resolve a default model. Open the task page once and pick a model, then try again.",
    },
    buildInput,
    analyticsExtras,
  });

  return { createPrReport: run, isCreatingPr: isRunning };
}
