import { sessionStoreSetters } from "@features/sessions/stores/sessionStore";
import { trpcClient } from "@renderer/trpc";
import { useCallback, useState } from "react";
import { toast } from "sonner";

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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingCheckpointId, setPendingCheckpointId] = useState<string | null>(
    null,
  );
  const [isRestoring, setIsRestoring] = useState(false);

  const requestRestore = useCallback((checkpointId: string) => {
    setPendingCheckpointId(checkpointId);
    setDialogOpen(true);
  }, []);

  const confirmRestore = useCallback(async () => {
    if (!pendingCheckpointId || !repoPath) return;

    setIsRestoring(true);
    try {
      await trpcClient.checkpoint.restore.mutate({
        checkpointId: pendingCheckpointId,
        repoPath,
        taskRunId,
      });
      if (taskId) {
        sessionStoreSetters.truncateEventsToCheckpoint(
          taskId,
          pendingCheckpointId,
        );
      }
      toast.success("Checkpoint restored successfully");
      setDialogOpen(false);
      setPendingCheckpointId(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to restore checkpoint";
      toast.error(message);
    } finally {
      setIsRestoring(false);
    }
  }, [pendingCheckpointId, repoPath, taskId, taskRunId]);

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
