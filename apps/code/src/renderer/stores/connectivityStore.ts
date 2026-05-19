import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

const log = logger.scope("connectivity-store");

interface ConnectivityState {
  isOnline: boolean;
  isChecking: boolean;

  // Actions
  setOnline: (isOnline: boolean) => void;
  check: () => Promise<void>;
}

export const useConnectivityStore = create<ConnectivityState>()(
  subscribeWithSelector((set) => ({
    isOnline: true, // Assume online initially
    isChecking: false,

    setOnline: (isOnline: boolean) => {
      set({ isOnline });
    },

    check: async () => {
      set({ isChecking: true });
      try {
        const result = await trpcClient.connectivity.checkNow.mutate();
        set({ isOnline: result.isOnline, isChecking: false });
      } catch (error) {
        log.error("Failed to check connectivity", { error });
        set({ isChecking: false });
      }
    },
  })),
);

// Initialize: fetch initial status and subscribe to changes
export function initializeConnectivityStore() {
  // Get initial status
  trpcClient.connectivity.getStatus
    .query()
    .then((status) => {
      useConnectivityStore.getState().setOnline(status.isOnline);
    })
    .catch((error) => {
      log.error("Failed to get initial connectivity status", { error });
    });

  // Subscribe to status changes
  const subscription = trpcClient.connectivity.onStatusChange.subscribe(
    undefined,
    {
      onData: (status) => {
        useConnectivityStore.getState().setOnline(status.isOnline);
      },
      onError: (error) => {
        log.error("Connectivity subscription error", { error });
      },
    },
  );

  return () => {
    subscription.unsubscribe();
  };
}

// Convenience selectors
export const getIsOnline = () => useConnectivityStore.getState().isOnline;
