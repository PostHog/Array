import { connectivityStore } from "@posthog/core/connectivity/connectivityStore";
import { toast as sonnerToast } from "sonner";
import { toast } from "../../primitives/toast";

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

// Debounces flaky transitions: only surfaces a toast when continuously offline
// for OFFLINE_DEBOUNCE_MS. The stable id guarantees the toast never stacks.
export function initializeConnectivityToast() {
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let wasOnline = connectivityStore.getState().isOnline;

  const clearPending = () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  const unsubscribe = connectivityStore.subscribe((state) => {
    if (state.isOnline === wasOnline) return;
    wasOnline = state.isOnline;

    if (!state.isOnline) {
      clearPending();
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        showOfflineToast();
      }, OFFLINE_DEBOUNCE_MS);
    } else {
      clearPending();
      sonnerToast.dismiss(TOAST_ID);
    }
  });

  return () => {
    clearPending();
    unsubscribe();
  };
}
