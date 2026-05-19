import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { useConnectivity } from "@hooks/useConnectivity";
import { trpcClient } from "@renderer/trpc/client";
import type { Task } from "@shared/types";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { useQueryClient } from "@tanstack/react-query";
import { logger } from "@utils/logger";
import { useEffect } from "react";
import { getSessionService } from "../service/service";
import { type AgentSession, sessionStoreSetters } from "../stores/sessionStore";
import { useChatTitleGenerator } from "./useChatTitleGenerator";

const log = logger.scope("session-connection");

const connectingTasks = new Set<string>();
const activityRecorded = new Set<string>();

interface UseSessionConnectionOptions {
  taskId: string;
  task: Task;
  session: AgentSession | undefined;
  repoPath: string | null;
  isCloud: boolean;
  isSuspended?: boolean;
}

export function useSessionConnection({
  taskId,
  task,
  session,
  repoPath,
  isCloud,
  isSuspended,
}: UseSessionConnectionOptions) {
  const queryClient = useQueryClient();
  const { isOnline } = useConnectivity();
  const cloudAuthState = useAuthStateValue((state) => state);

  useChatTitleGenerator(taskId);

  useEffect(() => {
    const taskRunId = session?.taskRunId;
    if (!taskRunId) return;
    if (!activityRecorded.has(taskRunId)) {
      activityRecorded.add(taskRunId);
      trpcClient.agent.recordActivity.mutate({ taskRunId }).catch(() => {});
    }
    const heartbeat = setInterval(
      () => {
        trpcClient.agent.recordActivity.mutate({ taskRunId }).catch(() => {});
      },
      5 * 60 * 1000,
    );
    return () => {
      clearInterval(heartbeat);
      activityRecorded.delete(taskRunId);
    };
  }, [session?.taskRunId]);

  useEffect(() => {
    if (!isCloud) return;
    getSessionService().updateSessionTaskTitle(
      task.id,
      task.title || task.description || "Cloud Task",
    );
  }, [isCloud, task.id, task.title, task.description]);

  useEffect(() => {
    if (!isCloud || !task.latest_run?.id) return;
    if (cloudAuthState.status !== "authenticated") return;
    if (!cloudAuthState.bootstrapComplete) return;
    if (!cloudAuthState.projectId || !cloudAuthState.cloudRegion) return;

    const runId = task.latest_run.id;
    const initialMode =
      typeof task.latest_run.state?.initial_permission_mode === "string"
        ? task.latest_run.state.initial_permission_mode
        : undefined;
    const adapter =
      task.latest_run.runtime_adapter === "codex" ? "codex" : "claude";
    const initialModel = task.latest_run.model ?? undefined;
    const cleanup = getSessionService().watchCloudTask(
      task.id,
      runId,
      getCloudUrlFromRegion(cloudAuthState.cloudRegion),
      cloudAuthState.projectId,
      () => {
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
      },
      task.latest_run?.log_url,
      initialMode,
      adapter,
      initialModel,
      task.description ?? undefined,
    );
    return cleanup;
  }, [
    cloudAuthState.bootstrapComplete,
    cloudAuthState.cloudRegion,
    cloudAuthState.projectId,
    cloudAuthState.status,
    isCloud,
    queryClient,
    task.id,
    task.latest_run?.id,
    task.latest_run?.log_url,
    task.latest_run?.model,
    task.latest_run?.runtime_adapter,
    task.latest_run?.state?.initial_permission_mode,
    task.description,
  ]);

  useEffect(() => {
    if (!repoPath) return;
    if (connectingTasks.has(taskId)) return;
    if (!isOnline) return;
    if (isCloud || session?.isCloud) return;
    if (isSuspended) return;

    if (session?.status === "error" && session?.idleKilled) {
      const taskRunId = session.taskRunId;
      connectingTasks.add(taskId);
      getSessionService()
        .clearSessionError(taskId, repoPath)
        .catch((error) => {
          log.error("Auto-reconnect after idle kill failed", error);
          sessionStoreSetters.updateSession(taskRunId, {
            idleKilled: false,
            errorMessage:
              "Session disconnected due to inactivity. Click Retry to reconnect.",
          });
        })
        .finally(() => {
          connectingTasks.delete(taskId);
        });
      return () => {
        connectingTasks.delete(taskId);
      };
    }

    if (
      session?.status === "connected" ||
      session?.status === "connecting" ||
      session?.status === "error"
    ) {
      return;
    }

    // New sessions (no latest_run) are handled by the task creation saga,
    // which passes model/adapter/executionMode. Only reconnect existing ones here.
    if (!task.latest_run?.id) return;

    connectingTasks.add(taskId);

    getSessionService()
      .connectToTask({
        task,
        repoPath,
      })
      .finally(() => {
        connectingTasks.delete(taskId);
      });

    return () => {
      connectingTasks.delete(taskId);
    };
  }, [task, taskId, repoPath, session, isOnline, isCloud, isSuspended]);

  const cannotConnect = !repoPath && !isCloud;
  useEffect(() => {
    if (!cannotConnect) return;
    if (session && session.events.length > 0) return;
    if (!task.latest_run?.id || !task.latest_run?.log_url) return;

    getSessionService().loadLogsOnly({
      taskId: task.id,
      taskRunId: task.latest_run.id,
      taskTitle: task.title || task.description || "Task",
      logUrl: task.latest_run.log_url,
    });
  }, [
    cannotConnect,
    task.id,
    task.latest_run?.id,
    task.latest_run?.log_url,
    task.title,
    task.description,
    session,
  ]);
}
