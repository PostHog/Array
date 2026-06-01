import { getSessionService } from "@features/sessions/service/service";
import { useConnectivityStore } from "@stores/connectivityStore";

// Wait for the connection to look stable before kicking recovery so a flapping
// network doesn't trigger a retry storm.
const RECONNECT_DEBOUNCE_MS = 1_500;

// When connectivity is restored, cloud sessions whose SSE stream exhausted its
// reconnect budget while offline are left in the `error` state with no stream
// to deliver `turn_complete`. `retryUnhealthyCloudSessions` re-establishes
// them. Previously this only ran on window focus; firing it on the
// offline->online transition lets a flaky-then-recovered connection self-heal
// without the user having to refocus the app.
export function initializeConnectivityRecovery() {
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  const clearPending = () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  const unsubscribe = useConnectivityStore.subscribe(
    (state) => state.isOnline,
    (isOnline, wasOnline) => {
      if (isOnline === wasOnline) return;

      if (!isOnline) {
        // Dropped (or flapped) before stabilizing — cancel any pending retry.
        clearPending();
        // Flag in-flight turns so a completion that arrives after the drop is
        // treated as possibly-incomplete rather than a clean "finished".
        getSessionService().markInflightTurnsNetworkDropped();
        return;
      }

      clearPending();
      // Connection is back — let in-flight turns resume instead of being
      // cancelled by their offline give-up timers. Done immediately (not
      // debounced) so a quick blip never trips the give-up.
      getSessionService().clearOfflineTurnGiveupTimers();
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        getSessionService().retryUnhealthyCloudSessions();
      }, RECONNECT_DEBOUNCE_MS);
    },
  );

  return () => {
    clearPending();
    unsubscribe();
  };
}
