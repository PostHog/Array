import { useThreadNavigationStore } from "@posthog/ui/features/sessions/threadNavigationStore";
import { useEffect } from "react";

/**
 * Consumes a pending scroll-to-message request for this task, handing it to the
 * transcript's own jump implementation and clearing it. Each transcript keeps its
 * own jump (DOM registry, virtualizer index, grouped-row index), so the store
 * carries the target and the caller supplies how to get there.
 */
export function useThreadScrollRequest(
  taskId: string | undefined,
  jumpToMessage: (messageId: string) => void,
): void {
  const requestedMessageId = useThreadNavigationStore((state) =>
    taskId ? state.scrollRequests[taskId] : null,
  );

  useEffect(() => {
    if (!taskId || !requestedMessageId) return;
    jumpToMessage(requestedMessageId);
    // Clear through getState so the store's action isn't a dependency, which
    // would re-run this effect on every unrelated store write.
    useThreadNavigationStore.getState().clearScrollRequest(taskId);
  }, [taskId, requestedMessageId, jumpToMessage]);
}
