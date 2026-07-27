import {
  contentToXml,
  xmlToContent,
} from "@posthog/core/message-editor/content";
import { PI_SESSION_CONTROLLER } from "@posthog/core/pi-runtime/identifiers";
import type {
  PiModelSelection,
  PiSessionController,
  PiThinkingLevel,
} from "@posthog/core/pi-runtime/piSessionController";
import { useService } from "@posthog/di/react";
import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Skeleton,
} from "@posthog/quill";
import type { AgentConversationEvent } from "@posthog/shared";
import { PromptInput } from "@posthog/ui/features/message-editor/components/PromptInput";
import { useDraftStore } from "@posthog/ui/features/message-editor/draftStore";
import { CloudInitializingView } from "@posthog/ui/features/sessions/components/CloudInitializingView";
import {
  CloudConnectionBanner,
  CloudStreamDisconnectedBanner,
} from "@posthog/ui/features/sessions/components/CloudSessionLifecycle";
import { ChatThread } from "@posthog/ui/features/sessions/components/chat-thread/ChatThread";
import type { PromptRecallHandler } from "@posthog/ui/features/sessions/components/chat-thread/composerPromptRecall";
import { CHAT_CONTENT_MAX_WIDTH } from "@posthog/ui/features/sessions/constants";
import { useMessagingModeStore } from "@posthog/ui/features/sessions/messagingModeStore";
import { useWorkspace } from "@posthog/ui/features/workspace/useWorkspace";
import { useConnectivity } from "@posthog/ui/hooks/useConnectivity";
import { toast } from "@posthog/ui/primitives/toast";
import { TaskDetailSkeleton } from "@posthog/ui/router/routeSkeletons";
import { Box, Flex } from "@radix-ui/themes";
import { type ReactElement, useCallback, useEffect, useRef } from "react";
import { useStore } from "zustand";
import { PiQueuedMessagesDock } from "./PiQueuedMessagesDock";
import {
  PiMessagingModeSelector,
  PiModelSelector,
  PiThinkingLevelSelector,
} from "./PiSessionControls";

interface PiSessionViewProps {
  taskId: string;
  taskRunId?: string;
}

export function PiSessionView({ taskId, taskRunId }: PiSessionViewProps) {
  const piSessionController = useService<PiSessionController>(
    PI_SESSION_CONTROLLER,
  );
  const session = useStore(
    piSessionController.store,
    (state) => state.sessions[taskId],
  );
  const draftActions = useDraftStore((state) => state.actions);
  const workspace = useWorkspace(taskId);
  const repoPath = workspace?.worktreePath ?? workspace?.folderPath;
  const messagingMode = useMessagingModeStore(
    (state) => state.modesByTaskId[taskId] ?? "steer",
  );
  const setMessagingMode = useMessagingModeStore((state) => state.setMode);
  const { isOnline } = useConnectivity();
  const promptRecallRef = useRef<PromptRecallHandler | null>(null);
  const handlePromptRecall = useCallback<PromptRecallHandler>(
    (direction) => promptRecallRef.current?.(direction) ?? null,
    [],
  );

  useEffect(() => {
    void piSessionController.ensureConnected(taskId, taskRunId).catch(() => {});
    return () => piSessionController.disconnect(taskId);
  }, [piSessionController, taskId, taskRunId]);

  const sessionAvailable = session?.connectionState === "connected";
  const status = session?.status;
  const isStreaming = status?.isStreaming ?? false;
  const isCompacting = status?.isCompacting ?? false;
  const isBashRunning = session?.isBashRunning ?? false;

  useEffect(() => {
    draftActions.setContext(taskId, {
      taskId,
      repoPath,
      disabled: isCompacting,
      isLoading: isStreaming || isBashRunning,
    });
  }, [
    draftActions,
    isBashRunning,
    isCompacting,
    isStreaming,
    repoPath,
    taskId,
  ]);

  useEffect(() => {
    if (!session?.commands) {
      return;
    }

    const piCommands = session.commands
      .filter((command) => command.name !== "compact")
      .map((command) => ({
        name: command.name,
        description: command.description ?? "",
      }));

    draftActions.setCommands(taskId, [
      {
        name: "compact",
        description: "Compact the current Pi session context",
        input: { hint: "optional instructions" },
      },
      ...piCommands,
    ]);
  }, [draftActions, session?.commands, taskId]);

  const sendPrompt = useCallback(
    (text: string) => {
      const message = text.trim();
      if (!message) {
        return;
      }

      const action = piSessionController.getSubmitAction(
        message,
        isStreaming,
        messagingMode,
      );
      void piSessionController
        .submit(taskId, message, isStreaming, messagingMode)
        .then(() => {
          if (action === "compact") {
            toast.success("Pi context compacted");
          }
        })
        .catch(() => {
          const failureMessage =
            action === "compact"
              ? "Failed to compact Pi context"
              : "Failed to send message to Pi";
          toast.error(failureMessage);
        });
    },
    [isStreaming, messagingMode, piSessionController, taskId],
  );

  const setModel = useCallback(
    (model: PiModelSelection) => {
      void piSessionController
        .setModel(taskId, model)
        .catch(() => toast.error("Failed to change Pi model"));
    },
    [piSessionController, taskId],
  );

  const setThinkingLevel = useCallback(
    (level: PiThinkingLevel) => {
      void piSessionController
        .setThinkingLevel(taskId, level)
        .catch(() => toast.error("Failed to change Pi thinking level"));
    },
    [piSessionController, taskId],
  );

  const toggleMessagingMode = useCallback(() => {
    const nextMode = messagingMode === "steer" ? "queue" : "steer";
    setMessagingMode(taskId, nextMode);
  }, [messagingMode, setMessagingMode, taskId]);

  const runBashCommand = (command: string) => {
    void piSessionController
      .bash(taskId, command)
      .catch(() => toast.error("Failed to run Pi bash command"));
  };

  const cancelPrompt = () => {
    if (isBashRunning) {
      void piSessionController.abortBash(taskId);
      return;
    }

    void piSessionController.abort(taskId);
  };

  const retry = useCallback(() => {
    void piSessionController
      .retry(taskId)
      .catch(() => toast.error("Failed to reconnect to Pi"));
  }, [piSessionController, taskId]);

  const restart = useCallback(() => {
    void piSessionController
      .restart(taskId)
      .catch(() => toast.error("Failed to restart Pi"));
  }, [piSessionController, taskId]);

  const editQueuedMessage = useCallback(() => {
    void piSessionController
      .clearQueue(taskId)
      .then((queue) => {
        const queuedText = [...queue.steering, ...queue.followUp].join("\n\n");
        if (!queuedText) {
          return;
        }
        const draft = draftActions.getDraft(taskId);
        const draftText =
          typeof draft === "string" ? draft : draft ? contentToXml(draft) : "";
        const content = [queuedText, draftText]
          .filter((value) => value.trim())
          .join("\n\n");
        draftActions.setPendingContent(taskId, xmlToContent(content));
        draftActions.requestFocus(taskId);
      })
      .catch(() => toast.error("Failed to edit queued Pi message"));
  }, [draftActions, piSessionController, taskId]);

  const removeQueuedMessage = useCallback(() => {
    void piSessionController
      .clearQueue(taskId)
      .catch(() => toast.error("Failed to discard queued Pi message"));
  }, [piSessionController, taskId]);

  if (!session) {
    return <TaskDetailSkeleton />;
  }

  const latestProgress = session.events.findLast(
    (event): event is Extract<AgentConversationEvent, { type: "progress" }> =>
      event.type === "progress" && event.status === "in_progress",
  );
  const isConnecting = session.connectionState === "connecting";
  const hasTranscript = session.events.some(
    (event) => event.type !== "progress",
  );
  if (isConnecting && !hasTranscript) {
    return (
      <Box className="relative h-full">
        <CloudInitializingView
          cloudStatus={session.cloudStatus ?? null}
          heading={latestProgress?.label}
          subtitle={latestProgress?.detail}
        />
      </Box>
    );
  }

  if (session.errorMessage && !hasTranscript) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>{session.errorTitle ?? "Pi session failed"}</EmptyTitle>
          <EmptyDescription>{session.errorMessage}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {session.errorRetryable && (
            <Button variant="primary" onClick={retry}>
              Retry
            </Button>
          )}
          <Button variant="outline" onClick={restart}>
            Restart
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (!status && !hasTranscript) {
    return <TaskDetailSkeleton />;
  }

  const controlsPending = status ? isStreaming || isBashRunning : false;
  const hasQueuedMessage =
    session.queue.steering.length + session.queue.followUp.length > 0;
  let modelSelector: ReactElement = <Skeleton className="h-7 w-32" />;
  let reasoningSelector: ReactElement | null = (
    <Skeleton className="h-7 w-20" />
  );
  let messagingModeToggle: ReactElement = <Skeleton className="h-7 w-24" />;

  if (status && session.modelsLoaded) {
    modelSelector = (
      <PiModelSelector
        models={session.models}
        currentModel={status.model}
        disabled={controlsPending || isCompacting}
        onChange={setModel}
      />
    );
  }

  if (status && session.thinkingLevelsLoaded) {
    const supportsThinking = session.thinkingLevels.some(
      (level) => level !== "off",
    );
    reasoningSelector = supportsThinking ? (
      <PiThinkingLevelSelector
        level={status.thinkingLevel}
        levels={session.thinkingLevels}
        disabled={controlsPending || isCompacting}
        onChange={setThinkingLevel}
      />
    ) : null;
  }

  if (status) {
    messagingModeToggle = (
      <PiMessagingModeSelector
        mode={messagingMode}
        queuedCount={status.pendingMessageCount}
        disabled={isBashRunning}
        onModeChange={(mode) => setMessagingMode(taskId, mode)}
      />
    );
  }

  return (
    <Flex direction="column" height="100%">
      {isConnecting && hasTranscript && (
        <CloudConnectionBanner message="Connecting to cloud runner..." />
      )}
      {session.errorMessage && hasTranscript && (
        <CloudStreamDisconnectedBanner
          errorTitle={session.errorTitle}
          errorMessage={session.errorMessage}
          onRetry={session.errorRetryable ? retry : undefined}
          onRestart={restart}
        />
      )}
      <Box className="min-h-0 flex-1">
        <ChatThread
          events={session.events}
          isPromptPending={isStreaming}
          taskId={taskId}
          repoPath={repoPath}
          promptRecallRef={promptRecallRef}
        />
      </Box>
      <Box
        className="mx-auto w-full px-2 pb-3"
        style={{ maxWidth: CHAT_CONTENT_MAX_WIDTH }}
      >
        <PiQueuedMessagesDock
          queue={session.queue}
          onEdit={editQueuedMessage}
          onRemove={removeQueuedMessage}
        />
        <PromptInput
          sessionId={taskId}
          taskId={taskId}
          repoPath={repoPath}
          placeholder="Type a message..."
          disabled={isCompacting}
          isLoading={controlsPending}
          submitDisabledExternal={
            !sessionAvailable || !status || !isOnline || hasQueuedMessage
          }
          submitTooltipOverride={
            !isOnline
              ? "No internet connection"
              : hasQueuedMessage
                ? "A message is already queued"
                : undefined
          }
          enableBashMode
          enableCommands
          modelSelector={modelSelector}
          reasoningSelector={reasoningSelector}
          messagingModeToggle={messagingModeToggle}
          onToggleMessagingMode={toggleMessagingMode}
          onPromptRecall={handlePromptRecall}
          onSubmit={sendPrompt}
          onBashCommand={runBashCommand}
          onCancel={cancelPrompt}
        />
      </Box>
    </Flex>
  );
}
