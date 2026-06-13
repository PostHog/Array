import { buildCloudTaskDescription } from "@posthog/core/editor/cloud-prompt";
import type { TaskCreationInput, WorkspaceMode } from "@posthog/shared";
import type { ExecutionMode } from "@posthog/shared/domain-types";

export interface PrepareTaskInputOptions {
  selectedDirectory: string;
  selectedRepository?: string | null;
  githubIntegrationId?: number;
  githubUserIntegrationId?: string;
  workspaceMode: WorkspaceMode;
  branch?: string | null;
  allowRemoteBranchCheckout?: boolean;
  executionMode?: ExecutionMode;
  adapter?: "claude" | "codex";
  model?: string;
  reasoningLevel?: string;
  environmentId?: string | null;
  sandboxEnvironmentId?: string;
  signalReportId?: string;
  additionalDirectories?: string[];
  channelContext?: string;
  channelName?: string;
}

export function prepareTaskInput(
  serializedContent: string,
  filePaths: string[],
  options: PrepareTaskInputOptions,
): TaskCreationInput {
  const isCloud = options.workspaceMode === "cloud";
  return {
    content: serializedContent,
    taskDescription: isCloud
      ? buildCloudTaskDescription(serializedContent, filePaths)
      : undefined,
    filePaths,
    repoPath: isCloud ? undefined : options.selectedDirectory,
    repository: isCloud ? options.selectedRepository : undefined,
    githubIntegrationId: options.githubIntegrationId,
    githubUserIntegrationId: options.githubUserIntegrationId,
    workspaceMode: options.workspaceMode,
    branch: options.branch,
    allowRemoteBranchCheckout: options.allowRemoteBranchCheckout,
    executionMode: options.executionMode,
    adapter: options.adapter,
    model: options.model,
    reasoningLevel: options.reasoningLevel,
    environmentId: options.environmentId ?? undefined,
    sandboxEnvironmentId: options.sandboxEnvironmentId,
    cloudPrAuthorshipMode:
      options.signalReportId && isCloud ? "user" : undefined,
    cloudRunSource:
      options.signalReportId && isCloud ? "signal_report" : undefined,
    signalReportId: options.signalReportId,
    additionalDirectories: isCloud ? undefined : options.additionalDirectories,
    channelContext: options.channelContext,
    channelName: options.channelName,
  };
}

const ERROR_TITLES: Record<string, string> = {
  repo_detection: "Failed to detect repository",
  task_creation: "Failed to create task",
  workspace_creation: "Failed to create workspace",
  cloud_prompt_preparation: "Failed to prepare cloud attachments",
  cloud_run: "Failed to start cloud execution",
  agent_session: "Failed to start agent session",
};

export function getErrorTitle(failedStep: string): string {
  return ERROR_TITLES[failedStep] ?? "Task creation failed";
}
