import type { Task } from "@posthog/shared/domain-types";
import { Flex } from "@radix-ui/themes";
import { useEffect } from "react";
import { useDraftStore } from "../../message-editor/draftStore";
import { SessionView } from "../../sessions/components/SessionView";
import { useSessionCallbacks } from "../../sessions/hooks/useSessionCallbacks";
import { useSessionConnection } from "../../sessions/hooks/useSessionConnection";
import { useSessionViewState } from "../../sessions/hooks/useSessionViewState";

interface CommandCenterSessionViewProps {
  taskId: string;
  task: Task;
  isActiveSession: boolean;
}

export function CommandCenterSessionView({
  taskId,
  task,
  isActiveSession,
}: CommandCenterSessionViewProps) {
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
    errorRetryable,
  } = useSessionViewState(taskId, task);

  useSessionConnection({ taskId, task, session, repoPath, isCloud });

  const {
    handleSendPrompt,
    handleCancelPrompt,
    handleRetry,
    handleNewSession,
    handleBashCommand,
  } = useSessionCallbacks({ taskId, task, session, repoPath });

  useEffect(() => {
    requestFocus(taskId);
  }, [taskId, requestFocus]);

  return (
    <Flex direction="column" height="100%">
      <SessionView
        events={events}
        taskId={taskId}
        task={task}
        isRunning={isRunning}
        isPromptPending={isPromptPending}
        promptStartedAt={promptStartedAt}
        onSendPrompt={handleSendPrompt}
        onBashCommand={isCloud ? undefined : handleBashCommand}
        onCancelPrompt={handleCancelPrompt}
        repoPath={repoPath}
        cloudBranch={cloudBranch}
        hasError={hasError}
        errorTitle={errorTitle}
        errorMessage={errorMessage ?? undefined}
        errorRetryable={errorRetryable}
        onRetry={handleRetry}
        onNewSession={isCloud ? undefined : handleNewSession}
        isInitializing={isInitializing}
        isCloud={isCloud}
        cloudStatus={cloudStatus}
        compact
        isActiveSession={isActiveSession}
      />
    </Flex>
  );
}
