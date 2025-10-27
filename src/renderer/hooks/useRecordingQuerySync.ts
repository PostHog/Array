import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useActiveRecordingStore } from "../stores/activeRecordingStore";

/**
 * Synchronizes Zustand active recording state with TanStack Query
 *
 * When active recordings change in Zustand (IDB), this hook invalidates
 * the desktop-recordings query so TanStack Query refetches from the backend.
 * This keeps the UI in sync across both local (active) and remote (past) recordings.
 */
export function useRecordingQuerySync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribe = useActiveRecordingStore.subscribe(() => {
      console.log(
        "[useRecordingQuerySync] Active recordings changed, invalidating queries",
      );
      queryClient.invalidateQueries({ queryKey: ["desktop-recordings"] });
    });

    return unsubscribe;
  }, [queryClient]);
}
