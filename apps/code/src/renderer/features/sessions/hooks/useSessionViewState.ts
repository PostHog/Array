import { useCwd } from "@features/sidebar/hooks/useCwd";
import { useIsCloudTask } from "@features/workspace/hooks/useIsCloudTask";
import { useWorkspace } from "@features/workspace/hooks/useWorkspace";
import type { Task } from "@shared/types";
import { useSessionForTask } from "../stores/sessionStore";

export function useSessionViewState(taskId: string, task: Task) {
  const session = useSessionForTask(taskId);
  const repoPath = useCwd(taskId) ?? null;
  const workspace = useWorkspace(taskId);
  const isCloud = useIsCloudTask(taskId, task);

  const cloudStatus = session?.cloudStatus ?? null;
  const isCloudRunNotTerminal =
    isCloud &&
    (!cloudStatus || cloudStatus === "queued" || cloudStatus === "in_progress");
  const isCloudRunTerminal = isCloud && !isCloudRunNotTerminal;

  const hasError = session?.status === "error" && !session?.idleKilled;
  const handoffInProgress = session?.handoffInProgress ?? false;

  let isRunning = false;
  if (!handoffInProgress) {
    if (isCloud) {
      isRunning = !hasError;
    } else {
      isRunning = session?.status === "connected";
    }
  }

  const events = session?.events ?? [];
  const isPromptPending = session?.isPromptPending ?? false;
  const promptStartedAt = session?.promptStartedAt;

  const isNewSessionWithInitialPrompt =
    !task.latest_run?.id && !!task.description;
  const isResumingExistingSession = !!task.latest_run?.id;
  const isInitializing = isCloud
    ? !hasError && (!session || (events.length === 0 && isCloudRunNotTerminal))
    : !session ||
      (session.status === "connecting" && events.length === 0) ||
      (session.status === "connected" &&
        events.length === 0 &&
        (isPromptPending ||
          isNewSessionWithInitialPrompt ||
          isResumingExistingSession));

  const cloudBranch = isCloud
    ? (workspace?.baseBranch ?? task.latest_run?.branch ?? null)
    : null;

  return {
    session,
    repoPath,
    isCloud,
    isCloudRunNotTerminal,
    isCloudRunTerminal,
    cloudStatus,
    isRunning: !!isRunning,
    hasError,
    events,
    isPromptPending,
    promptStartedAt,
    isInitializing,
    cloudBranch,
    errorTitle: session?.errorTitle,
    errorMessage:
      session?.errorMessage ??
      (isCloud ? session?.cloudErrorMessage : undefined),
    errorRetryable: session?.errorRetryable,
  };
}
