import { useConnectivityStore } from "@stores/connectivityStore";
import { toast } from "@utils/toast";
import { toast as sonnerToast } from "sonner";

const TOAST_ID = "connectivity-offline";
const OFFLINE_DEBOUNCE_MS = 5_000;

export function showOfflineToast() {
  toast.error("No internet connection", {
    id: TOAST_ID,
    duration: Number.POSITIVE_INFINITY,
    description:
      "PostHog Code features that need the network are paused until you reconnect.",
  });
}

// Debounces flaky transitions: only surfaces a toast when the app has been
// continuously offline for OFFLINE_DEBOUNCE_MS. The stable id guarantees the
// toast never stacks; coming back online dismisses it automatically.
export function initializeConnectivityToast() {
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
        clearPending();
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          showOfflineToast();
        }, OFFLINE_DEBOUNCE_MS);
      } else {
        clearPending();
        sonnerToast.dismiss(TOAST_ID);
      }
    },
  );

  return () => {
    clearPending();
    unsubscribe();
  };
}
