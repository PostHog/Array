import type {
  GitInteractionEffects,
  IGitWriteClient,
} from "@posthog/core/git-interaction/gitInteractionService";
import { resolveService } from "@posthog/di/container";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";
import { ANALYTICS_EVENTS } from "@posthog/shared";
import { getAuthenticatedClient } from "@posthog/ui/features/auth/authClientImperative";
import { useOnboardingStore } from "@posthog/ui/features/onboarding/onboardingStore";
import { useSessionStore } from "@posthog/ui/features/sessions/sessionStore";
import { celebrate } from "@posthog/ui/primitives/confetti";
import { track } from "@posthog/ui/shell/analytics";
import { logger } from "@posthog/ui/shell/logger";
import { openExternalUrl } from "@posthog/ui/shell/openExternal";

const log = logger.scope("git-interaction");

function host(): HostTrpcClient {
  return resolveService<HostTrpcClient>(HOST_TRPC_CLIENT);
}

export const gitWriteClient: IGitWriteClient = {
  commit: (input) => host().git.commit.mutate(input),
  push: (directoryPath, signal) =>
    host().git.push.mutate({ directoryPath }, { signal }),
  sync: (directoryPath, signal) =>
    host().git.sync.mutate({ directoryPath }, { signal }),
  publish: (directoryPath, signal) =>
    host().git.publish.mutate({ directoryPath }, { signal }),
  createBranch: async (directoryPath, branchName) => {
    await host().git.createBranch.mutate({ directoryPath, branchName });
  },
  createPr: (input) => host().git.createPr.mutate(input),
  openPr: (directoryPath) => host().git.openPr.mutate({ directoryPath }),
  generateCommitMessage: (input) =>
    host().git.generateCommitMessage.mutate(input),
  generatePrTitleAndBody: (input) =>
    host().git.generatePrTitleAndBody.mutate(input),
  linkBranch: async (taskId, branchName) => {
    await host().workspace.linkBranch.mutate({ taskId, branchName });
  },
  onCreatePrProgress: (flowId, onStep) => {
    const subscription = host().git.onCreatePrProgress.subscribe(undefined, {
      onData: (data) => {
        if (data.flowId !== flowId) return;
        onStep(data.step);
      },
    });
    return () => subscription.unsubscribe();
  },
};

function getConversationContext(taskId: string): string | undefined {
  const state = useSessionStore.getState();
  const taskRunId = state.taskIdIndex[taskId];
  if (!taskRunId) return undefined;
  return state.sessions[taskRunId]?.conversationSummary;
}

function attachPrUrlToTask(taskId: string, prUrl: string): void {
  const taskRunId = useSessionStore.getState().taskIdIndex[taskId];
  if (!taskRunId) return;
  void getAuthenticatedClient().then((client) => {
    if (!client) return;
    client
      .updateTaskRun(taskId, taskRunId, { output: { pr_url: prUrl } })
      .catch((err) =>
        log.warn("Failed to attach PR URL to task", { taskId, prUrl, err }),
      );
  });
}

export const gitInteractionEffects: GitInteractionEffects = {
  trackGitAction: (taskId, actionType, success, stagingContext) => {
    track(ANALYTICS_EVENTS.GIT_ACTION_EXECUTED, {
      action_type: actionType,
      success,
      task_id: taskId,
      ...stagingContext,
    });
  },
  trackPrCreated: (taskId, success) => {
    track(ANALYTICS_EVENTS.PR_CREATED, { task_id: taskId, success });
  },
  hasShippedFirstPr: () => useOnboardingStore.getState().hasShippedFirstPr,
  markFirstPrShipped: () => useOnboardingStore.getState().markFirstPrShipped(),
  celebrate: () => celebrate(),
  openExternalUrl: (url) => openExternalUrl(url),
  attachPrUrlToTask,
  getConversationContext,
  logError: (message, error) => log.error(message, error),
  logWarn: (message, context) => log.warn(message, context),
};
