import { resolveService } from "@posthog/di/container";
import {
  IMPERATIVE_QUERY_CLIENT,
  type ImperativeQueryClient,
} from "@posthog/ui/shell/queryClient";
import { create } from "zustand";
import { CANVAS_QUERY_KEY } from "../freeform/freeformDataBridge";

// View-state bridge between the toolbar Refresh button and a freeform canvas:
// the button and the iframe live in separate subtrees, connected only by the
// canvas thread id. Bumping a thread's nonce reloads its sandbox iframe, which
// re-mounts the React app and re-runs its `ph.query` calls — but those reads are
// cached host-side, so a reload alone would re-serve stale data. Invalidating
// the canvas read cache first makes the reload actually refetch.
interface CanvasRefreshStore {
  nonces: Record<string, number>;
  bump: (threadId: string) => void;
}

export const useCanvasRefreshStore = create<CanvasRefreshStore>()((set) => ({
  nonces: {},
  bump: (threadId) => {
    resolveService<ImperativeQueryClient>(
      IMPERATIVE_QUERY_CLIENT,
    ).invalidateQueries({ queryKey: [CANVAS_QUERY_KEY] });
    set((s) => ({
      nonces: { ...s.nonces, [threadId]: (s.nonces[threadId] ?? 0) + 1 },
    }));
  },
}));

export function useCanvasRefreshNonce(threadId: string): number {
  return useCanvasRefreshStore((s) => s.nonces[threadId] ?? 0);
}
