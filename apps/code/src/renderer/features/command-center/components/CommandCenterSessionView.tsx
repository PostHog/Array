import { useDraftStore } from "@features/message-editor/stores/draftStore";
import { SessionView } from "@features/sessions/components/SessionView";
import { useSessionCallbacks } from "@features/sessions/hooks/useSessionCallbacks";
import { useSessionConnection } from "@features/sessions/hooks/useSessionConnection";
import { useSessionViewState } from "@features/sessions/hooks/useSessionViewState";
import { Flex } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { useEffect } from "react";

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
