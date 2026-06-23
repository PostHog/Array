import { create } from "zustand";

// View-state bridge between the toolbar Refresh button and a freeform canvas:
// the button and the iframe live in separate subtrees, connected only by the
// canvas thread id. Bumping a thread's nonce reloads its sandbox iframe, which
// re-mounts the React app and re-runs its `ph.query` calls (fresh data).
//
// NB: canvas reads are cached host-side (see freeformDataBridge), so a refresh
// trigger should also invalidate the relevant `CANVAS_QUERY_KEY` entries via the
// QueryClient — done at the call site (which has `useQueryClient`), not here: a
// store holds state only and must not reach into a client.
interface CanvasRefreshStore {
  nonces: Record<string, number>;
  bump: (threadId: string) => void;
}

export const useCanvasRefreshStore = create<CanvasRefreshStore>()((set) => ({
  nonces: {},
  bump: (threadId) =>
    set((s) => ({
      nonces: { ...s.nonces, [threadId]: (s.nonces[threadId] ?? 0) + 1 },
    })),
}));

export function useCanvasRefreshNonce(threadId: string): number {
  return useCanvasRefreshStore((s) => s.nonces[threadId] ?? 0);
}
