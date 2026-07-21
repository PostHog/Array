import type { CloudTaskQueuedMessage } from "@posthog/core/sessions/cloudTaskQueue";
import { useSyncExternalStore } from "react";
import type { PendingAttachment } from "../composer/attachments/types";
import { taskMessageQueue } from "../lib/taskMessageQueue";

interface TaskMessageQueueSelection {
  messages: readonly CloudTaskQueuedMessage<PendingAttachment>[];
  editingId: string | undefined;
}

export function useTaskMessageQueue(taskId: string): TaskMessageQueueSelection {
  const snapshot = useSyncExternalStore(
    taskMessageQueue.subscribe,
    taskMessageQueue.getSnapshot,
  );
  return {
    messages: snapshot.queuesByTaskId[taskId] ?? [],
    editingId: snapshot.editingByTaskId[taskId],
  };
}
