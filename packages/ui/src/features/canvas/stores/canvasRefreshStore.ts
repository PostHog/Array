import { create } from "zustand";

// View-state bridge between the toolbar Refresh button and a freeform canvas:
// the button and the iframe live in separate subtrees, connected only by the
// canvas thread id. Bumping a thread's nonce reloads its sandbox iframe, which
// re-mounts the React app and re-runs its `ph.query` calls (fresh data).
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
