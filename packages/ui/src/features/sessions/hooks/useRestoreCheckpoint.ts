import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import { sessionStoreSetters } from "@posthog/core/sessions/sessionStore";
import { useService } from "@posthog/di/react";
import { toast } from "@posthog/ui/primitives/toast";
import { useCallback, useState } from "react";

interface UseRestoreCheckpointOptions {
  repoPath: string | undefined;
  taskId: string | undefined;
  taskRunId: string | undefined;
}

export function useRestoreCheckpoint({
  repoPath,
  taskId,
  taskRunId,
}: UseRestoreCheckpointOptions) {
  const sessionService = useService<SessionService>(SESSION_SERVICE);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingCheckpointId, setPendingCheckpointId] = useState<string | null>(
    null,
  );
  const [isRestoring, setIsRestoring] = useState(false);

  const requestRestore = useCallback(
    (checkpointId: string) => {
      // Don't let a new restore race the previous one's reconnect (the agent is
      // mid-respawn and can't accept the resume yet).
      const session = taskId
        ? sessionStoreSetters.getSessionByTaskId(taskId)
        : undefined;
      if (session?.isReconnecting) {
        toast.info("Hang on — finishing the previous restore.");
        return;
      }
      setPendingCheckpointId(checkpointId);
      setDialogOpen(true);
    },
    [taskId],
  );

  const confirmRestore = useCallback(async () => {
    if (!pendingCheckpointId || !repoPath) return;

    const session = taskId
      ? sessionStoreSetters.getSessionByTaskId(taskId)
      : undefined;

    // Checkpoint packs from cloud turns are only available in local git after
    // the cloud→local handoff (syncCloudCheckpointsFromLog). If the task is
    // still running in the cloud, guide the user to continue locally first.
    if (session?.isCloud) {
      toast.info(
        "To restore a cloud checkpoint, continue the task locally first.",
      );
      setDialogOpen(false);
      setPendingCheckpointId(null);
      return;
    }

    setIsRestoring(true);
    try {
      const restoreResult = await sessionService.restoreCheckpoint({
        checkpointId: pendingCheckpointId,
        repoPath,
        taskRunId,
      });
      if (taskId) {
        sessionStoreSetters.truncateEventsToCheckpoint(
          taskId,
          pendingCheckpointId,
        );
        // Reconnect the agent, resuming the same Codex/Claude session so the
        // agent has memory only up to the restored checkpoint.
        sessionService
          .restoreCheckpointReconnect(
            taskId,
            repoPath,
            restoreResult?.restoredSessionId,
            restoreResult?.adapter,
          )
          .catch(() => {});
      }
      if (restoreResult?.truncationFailed) {
        toast.warning(
          "Checkpoint restored, but trimming the agent's history failed — it may still remember messages after this point.",
        );
      } else {
        toast.success("Checkpoint restored successfully");
      }
      setDialogOpen(false);
      setPendingCheckpointId(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to restore checkpoint";
      toast.error(message);
    } finally {
      setIsRestoring(false);
    }
  }, [pendingCheckpointId, repoPath, taskId, taskRunId, sessionService]);

  const cancelRestore = useCallback(() => {
    setDialogOpen(false);
    setPendingCheckpointId(null);
  }, []);

  return {
    dialogOpen,
    setDialogOpen,
    isRestoring,
    requestRestore,
    confirmRestore,
    cancelRestore,
  };
}
