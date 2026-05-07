import { BackgroundWrapper } from "@components/BackgroundWrapper";
import { ErrorBoundary } from "@components/ErrorBoundary";
import { useFolders } from "@features/folders/hooks/useFolders";
import { useDraftStore } from "@features/message-editor/stores/draftStore";
import { ProvisioningView } from "@features/provisioning/components/ProvisioningView";
import { useProvisioningStore } from "@features/provisioning/stores/provisioningStore";
import { SessionView } from "@features/sessions/components/SessionView";
import { useSessionCallbacks } from "@features/sessions/hooks/useSessionCallbacks";
import { useSessionConnection } from "@features/sessions/hooks/useSessionConnection";
import { useSessionViewState } from "@features/sessions/hooks/useSessionViewState";
import { useRestoreTask } from "@features/suspension/hooks/useRestoreTask";
import { useSuspendedTaskIds } from "@features/suspension/hooks/useSuspendedTaskIds";
import { BranchMismatchDialog } from "@features/task-detail/components/BranchMismatchDialog";
import { WorkspaceSetupPrompt } from "@features/task-detail/components/WorkspaceSetupPrompt";
import { useBranchMismatchDialog } from "@features/workspace/hooks/useBranchMismatchDialog";
import {
  useCreateWorkspace,
  useWorkspaceLoaded,
} from "@features/workspace/hooks/useWorkspace";
import { Box, Flex } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { getTaskRepository } from "@utils/repository";
import { useCallback, useEffect } from "react";

interface TaskLogsPanelProps {
  taskId: string;
  task: Task;
  /** Hide the message input — log-only view. */
  hideInput?: boolean;
}

export function TaskLogsPanel({ taskId, task, hideInput }: TaskLogsPanelProps) {
  const isWorkspaceLoaded = useWorkspaceLoaded();
  const { isPending: isCreatingWorkspace } = useCreateWorkspace();
  const repoKey = getTaskRepository(task);
  const { folders } = useFolders();
  const hasDirectoryMapping = repoKey
    ? folders.some((f) => f.remoteUrl === repoKey)
    : false;

  const suspendedTaskIds = useSuspendedTaskIds();
  const isSuspended = suspendedTaskIds.has(taskId);
  const { restoreTask, isRestoring } = useRestoreTask();

  const isProvisioning = useProvisioningStore((s) => s.activeTasks.has(taskId));

  const { requestFocus } = useDraftStore((s) => s.actions);

  const {
    session,
    repoPath,
    isCloud,
    isRunning,
    hasError,
    events,
    isPromptPending,
    promptStartedAt,
    isInitializing,
    cloudBranch,
    cloudStatus,
    errorTitle,
    errorMessage,
  } = useSessionViewState(taskId, task);

  useSessionConnection({
    taskId,
    task,
    session,
    repoPath,
    isCloud,
    isSuspended,
  });

  const {
    handleSendPrompt,
    handleCancelPrompt,
    handleRetry,
    handleNewSession,
    handleBashCommand,
  } = useSessionCallbacks({ taskId, task, session, repoPath });

  const { handleBeforeSubmit, dialogProps } = useBranchMismatchDialog({
    taskId,
    repoPath,
    onSendPrompt: handleSendPrompt,
  });

  const slackThreadUrl =
    typeof task.latest_run?.state?.slack_thread_url === "string"
      ? task.latest_run.state.slack_thread_url
      : undefined;

  useEffect(() => {
    requestFocus(taskId);
  }, [taskId, requestFocus]);

  const handleRestoreWorktree = useCallback(async () => {
    await restoreTask(taskId);
  }, [taskId, restoreTask]);

  if (isProvisioning) {
    return <ProvisioningView taskId={taskId} />;
  }

  if (
    !repoPath &&
    !isCloud &&
    !isSuspended &&
    isWorkspaceLoaded &&
    !hasDirectoryMapping &&
    !isCreatingWorkspace
  ) {
    return (
      <BackgroundWrapper>
        <Box height="100%" width="100%">
          <WorkspaceSetupPrompt taskId={taskId} task={task} />
        </Box>
      </BackgroundWrapper>
    );
  }

  return (
    <BackgroundWrapper>
      <Flex direction="column" height="100%" width="100%">
        <Box className="min-h-0 flex-1">
          <ErrorBoundary name="SessionView">
            <SessionView
              events={events}
              taskId={taskId}
              task={task}
              isRunning={isRunning}
              isSuspended={isSuspended}
              onRestoreWorktree={
                isSuspended ? handleRestoreWorktree : undefined
              }
              isRestoring={isRestoring}
              isPromptPending={isPromptPending}
              promptStartedAt={promptStartedAt}
              onBeforeSubmit={handleBeforeSubmit}
              onSendPrompt={handleSendPrompt}
              onBashCommand={isCloud ? undefined : handleBashCommand}
              onCancelPrompt={handleCancelPrompt}
              repoPath={repoPath}
              cloudBranch={cloudBranch}
              hasError={hasError}
              errorTitle={errorTitle}
              errorMessage={errorMessage ?? undefined}
              hideInput={hideInput}
              onRetry={handleRetry}
              onNewSession={isCloud ? undefined : handleNewSession}
              isInitializing={isInitializing}
              isCloud={isCloud}
              cloudStatus={cloudStatus}
              slackThreadUrl={slackThreadUrl}
            />
          </ErrorBoundary>
        </Box>
      </Flex>

      {dialogProps && <BranchMismatchDialog {...dialogProps} />}
    </BackgroundWrapper>
  );
}
