import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import { useService } from "@posthog/di/react";
import { useMessagingMode } from "@posthog/ui/features/sessions/hooks/useMessagingMode";
import { useMessagingModeStore } from "@posthog/ui/features/sessions/messagingModeStore";
import { sessionStoreSetters } from "@posthog/ui/features/sessions/sessionStore";
import { useCallback } from "react";

/**
 * Toggle a task between Steer and Queue, transferring pending messages so they
 * follow the new mode:
 * - Queue -> Steer: locally buffered messages are flushed into the running turn
 *   as steers (sent to the backend now).
 * - Steer -> Queue: future messages buffer locally. Steers already handed to the
 *   backend keep injecting; the Claude SDK exposes no way to recall them.
 */
export function useToggleMessagingMode(taskId: string | undefined): () => void {
  const sessionService = useService<SessionService>(SESSION_SERVICE);
  const mode = useMessagingMode(taskId);
  const setMode = useMessagingModeStore((s) => s.setMode);

  return useCallback(() => {
    if (!taskId) return;
    const next = mode === "steer" ? "queue" : "steer";
    setMode(taskId, next);

    if (next === "steer") {
      const queued = sessionStoreSetters.dequeueMessages(taskId);
      for (const message of queued) {
        void sessionService.sendPrompt(taskId, message.content, {
          steer: true,
        });
      }
    }
  }, [taskId, mode, setMode, sessionService]);
}
