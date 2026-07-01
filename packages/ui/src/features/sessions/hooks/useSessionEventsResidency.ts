import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import { useService } from "@posthog/di/react";
import { useEffect } from "react";

/**
 * Ties a task's transcript memory to whether its view is mounted: reloads the
 * transcript from disk on view (if it was freed while backgrounded) and
 * schedules it to be freed a short while after the view unmounts. Only
 * disconnected background sessions are actually evicted — see
 * {@link SessionService.scheduleEventEviction}.
 */
export function useSessionEventsResidency(taskId: string | undefined): void {
  const sessionService = useService<SessionService>(SESSION_SERVICE);

  useEffect(() => {
    if (!taskId) return;
    void sessionService.ensureEventsLoaded(taskId);
    return () => {
      sessionService.scheduleEventEviction(taskId);
    };
  }, [taskId, sessionService]);
}
