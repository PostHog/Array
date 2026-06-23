import { xmlToContent } from "@posthog/core/message-editor/content";
import {
  combineQueuedCloudPrompts,
  promptToQueuedEditorContent,
} from "@posthog/core/sessions/cloudPrompt";
import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import { useService } from "@posthog/di/react";
import type { Task } from "@posthog/shared/domain-types";
import { tryExecuteCodeCommand } from "@posthog/ui/features/message-editor/commands";
import { useDraftStore } from "@posthog/ui/features/message-editor/draftStore";
import { useMessagingMode } from "@posthog/ui/features/sessions/hooks/useMessagingMode";
import {
  type AgentSession,
  sessionStoreSetters,
} from "@posthog/ui/features/sessions/sessionStore";
import { useTaskViewed } from "@posthog/ui/features/sidebar/useTaskViewed";
import {
  SHELL_CLIENT,
  type ShellClient,
} from "@posthog/ui/features/terminal/shellClient";
import { toast } from "@posthog/ui/primitives/toast";
import { getAppViewSnapshot } from "@posthog/ui/router/useAppView";
import { logger } from "@posthog/ui/shell/logger";
import { useCallback, useRef } from "react";

const log = logger.scope("session-callbacks");

interface UseSessionCallbacksOptions {
  taskId: string;
  task: Task;
  session: AgentSession | undefined;
  repoPath: string | null;
}

export function useSessionCallbacks({
  taskId,
  task,
  session,
  repoPath,
}: UseSessionCallbacksOptions) {
  const sessionService = useService<SessionService>(SESSION_SERVICE);
  const shellClient = useService<ShellClient>(SHELL_CLIENT);
  const { markActivity, markAsViewed } = useTaskViewed();
  const { requestFocus, setPendingContent } = useDraftStore((s) => s.actions);

  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Serialized text of the most recent non-steer send, used to refill the
  // composer if that turn is cancelled before the agent starts working.
  const lastSentTextRef = useRef<string | null>(null);

  const messagingMode = useMessagingMode(taskId);

  const isViewingTask = useCallback(() => {
    const view = getAppViewSnapshot();
    return view?.type === "task-detail" && view?.taskId === taskId;
  }, [taskId]);

  const handleSendPrompt = useCallback(
    async (text: string) => {
      const currentSession = sessionRef.current;
      const currentEvents = currentSession?.events ?? [];
      const handled = await tryExecuteCodeCommand(text, {
        taskId,
        repoPath,
        session: currentSession
          ? {
              taskRunId: currentSession.taskRunId,
              logUrl: currentSession.logUrl,
              events: currentEvents,
            }
          : null,
        taskRun: task.latest_run ?? null,
      });
      if (handled) return;

      try {
        markAsViewed(taskId);
        markActivity(taskId);

        const steer = messagingMode === "steer";
        // A steer folds into the running turn rather than starting its own, so it
        // isn't a candidate for refill-on-cancel. Whether a non-steer send starts
        // a turn or is queued, refill stays correct: a queued message is restored
        // from the queue on cancel (below), which takes priority over this text.
        lastSentTextRef.current = steer ? null : text;

        await sessionService.sendPrompt(taskId, text, { steer });

        if (isViewingTask()) {
          markAsViewed(taskId);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to send message";
        toast.error(message);
        log.error("Failed to send prompt", error);
      }
    },
    [
      taskId,
      repoPath,
      markActivity,
      markAsViewed,
      task.latest_run,
      sessionService,
      messagingMode,
      isViewingTask,
    ],
  );

  const handleCancelPrompt = useCallback(async () => {
    // Consume the stash up front so a second cancel can't refill twice. The
    // cancelled message stays in history (it's already in the agent's context);
    // we only refill the composer when the agent hadn't started working yet.
    const justSent = lastSentTextRef.current;
    lastSentTextRef.current = null;
    const agentStarted = sessionService.hasAgentStartedCurrentTurn(taskId);

    const queuedMessages = sessionStoreSetters.dequeueMessages(taskId);
    const result = await sessionService.cancelPrompt(taskId);
    log.info("Prompt cancelled", { success: result });

    const queuedPrompt = sessionRef.current?.isCloud
      ? combineQueuedCloudPrompts(queuedMessages)
      : queuedMessages.map((message) => message.content).join("\n\n");

    if (queuedPrompt) {
      // Queued messages are the more recent intent, so they win over justSent.
      const pendingContent = sessionRef.current?.isCloud
        ? promptToQueuedEditorContent(queuedPrompt)
        : {
            segments: [
              {
                type: "text" as const,
                text: typeof queuedPrompt === "string" ? queuedPrompt : "",
              },
            ],
          };

      setPendingContent(taskId, pendingContent);
    } else if (justSent && !agentStarted && isViewingTask()) {
      // Refill the just-sent message so it can be edited and re-sent, but only
      // while focused on this chat. xmlToContent restores attachment chips.
      setPendingContent(taskId, xmlToContent(justSent));
    }
    requestFocus(taskId);
  }, [taskId, setPendingContent, requestFocus, sessionService, isViewingTask]);

  const handleRetry = useCallback(async () => {
    try {
      if (sessionRef.current?.isCloud) {
        await sessionService.retryCloudTaskWatch(taskId);
        return;
      }

      if (!repoPath) return;
      await sessionService.clearSessionError(taskId, repoPath);
    } catch (error) {
      log.error("Failed to clear session error", error);
      toast.error("Failed to retry. Please try again.");
    }
  }, [taskId, repoPath, sessionService]);

  const handleNewSession = useCallback(async () => {
    if (!repoPath) return;
    try {
      await sessionService.resetSession(taskId, repoPath);
    } catch (error) {
      log.error("Failed to reset session", error);
      toast.error("Failed to start new session. Please try again.");
    }
  }, [taskId, repoPath, sessionService]);

  const handleBashCommand = useCallback(
    async (command: string) => {
      if (!repoPath) return;

      const execId = `user-shell-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      await sessionService.startUserShellExecute(
        taskId,
        execId,
        command,
        repoPath,
      );

      try {
        const result = await shellClient.execute({
          cwd: repoPath,
          command,
        });
        await sessionService.completeUserShellExecute(
          taskId,
          execId,
          command,
          repoPath,
          result,
        );
      } catch (error) {
        log.error("Failed to execute shell command", error);
        await sessionService.completeUserShellExecute(
          taskId,
          execId,
          command,
          repoPath,
          {
            stdout: "",
            stderr: error instanceof Error ? error.message : "Command failed",
            exitCode: 1,
          },
        );
      }
    },
    [taskId, repoPath, sessionService, shellClient],
  );

  const initiateHandoffToCloud = useCallback(async () => {
    if (!repoPath) return;
    try {
      await sessionService.handoffToCloud(taskId, repoPath);
    } catch (error) {
      log.error("Failed to hand off to cloud", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Failed to continue in cloud: ${message}`);
    }
  }, [taskId, repoPath, sessionService]);

  return {
    handleSendPrompt,
    handleCancelPrompt,
    handleRetry,
    handleNewSession,
    handleBashCommand,
    initiateHandoffToCloud,
  };
}
