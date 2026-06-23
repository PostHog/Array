import {
  type ReconcileSessionState,
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import { useService } from "@posthog/di/react";
import type { Task } from "@posthog/shared/domain-types";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import type { AgentSession } from "@posthog/ui/features/sessions/sessionStore";
import { useConnectivity } from "@posthog/ui/hooks/useConnectivity";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useChatTitleGenerator } from "./useChatTitleGenerator";

interface UseSessionConnectionOptions {
  taskId: string;
  task: Task;
  session: AgentSession | undefined;
  repoPath: string | null;
  isCloud: boolean;
  isSuspended?: boolean;
}

export function useSessionConnection({
  task,
  session,
  repoPath,
  isCloud,
  isSuspended,
}: UseSessionConnectionOptions) {
  const queryClient = useQueryClient();
  const { isOnline } = useConnectivity();
  const cloudAuthState = useAuthStateValue((state) => state);
  const sessionService = useService<SessionService>(SESSION_SERVICE);

  useChatTitleGenerator(task);

  const taskRunId = session?.taskRunId;
  const sessionTaskId = session?.taskId;
  const sessionTaskTitle = session?.taskTitle;
  const sessionStatus = session?.status;
  const sessionIsCloud = session?.isCloud;
  const sessionIdleKilled = session?.idleKilled;
  const needsEventCount = !repoPath && !isCloud;
  const sessionEventCount = needsEventCount ? (session?.events.length ?? 0) : 0;
  const connectionSession = useMemo<ReconcileSessionState | undefined>(() => {
    if (
      taskRunId === undefined ||
      sessionTaskId === undefined ||
      sessionTaskTitle === undefined ||
      sessionStatus === undefined
    ) {
      return undefined;
    }
    return {
      taskRunId,
      taskId: sessionTaskId,
      taskTitle: sessionTaskTitle,
      status: sessionStatus,
      isCloud: sessionIsCloud,
      idleKilled: sessionIdleKilled,
      eventCount: sessionEventCount,
    };
  }, [
    taskRunId,
    sessionTaskId,
    sessionTaskTitle,
    sessionStatus,
    sessionIsCloud,
    sessionIdleKilled,
    sessionEventCount,
  ]);

  useEffect(() => {
    if (!taskRunId) return;
    return sessionService.startActivityHeartbeat(taskRunId);
  }, [taskRunId, sessionService]);

  useEffect(() => {
    return sessionService.reconcileTaskConnection({
      task,
      session: connectionSession,
      repoPath,
      isCloud,
      isSuspended,
      isOnline,
      cloudAuth: {
        status: cloudAuthState.status,
        bootstrapComplete: cloudAuthState.bootstrapComplete,
        projectId: cloudAuthState.currentProjectId,
        cloudRegion: cloudAuthState.cloudRegion,
      },
      onCloudStatusChange: () => {
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
      },
    });
  }, [
    task,
    connectionSession,
    repoPath,
    isCloud,
    isSuspended,
    isOnline,
    cloudAuthState.status,
    cloudAuthState.bootstrapComplete,
    cloudAuthState.currentProjectId,
    cloudAuthState.cloudRegion,
    queryClient,
    sessionService,
  ]);
}
