import { useCallback } from "react";
import { taskSessionActions } from "../services/taskSessionService";
import {
  type MessagingMode,
  useMessagingModeStore,
} from "../stores/messagingModeStore";
import { useTaskMessageQueue } from "./useTaskMessageQueue";

/** Effective mode for a task: per-task override, else the global default. */
export function useMessagingMode(taskId: string | undefined): MessagingMode {
  return useMessagingModeStore((s) => s.getEffectiveMode(taskId));
}

export function useQueuedCount(taskId: string | undefined): number {
  return useTaskMessageQueue(taskId ?? "").messages.length;
}

/**
 * Toggle the per-task messaging mode. Switching to Steer flushes any buffered
 * messages into the current turn so nothing stays stuck in a queue the user
 * just turned off.
 */
export function useToggleMessagingMode(taskId: string | undefined): () => void {
  const mode = useMessagingMode(taskId);
  return useCallback(() => {
    if (!taskId) return;
    const next: MessagingMode = mode === "steer" ? "queue" : "steer";
    useMessagingModeStore.getState().setMode(taskId, next);
    if (next === "steer") {
      void taskSessionActions.flushQueuedMessages(taskId);
    }
  }, [taskId, mode]);
}
