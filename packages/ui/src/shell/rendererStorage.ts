import { createJSONStorage, type StateStorage } from "zustand/middleware";

export interface RendererStateStorage extends StateStorage {}

let hostStorage: RendererStateStorage | null = null;
let resolveHostStorage: ((storage: RendererStateStorage) => void) | null = null;
const hostStorageReady = new Promise<RendererStateStorage>((resolve) => {
  resolveHostStorage = resolve;
});

const pendingFirstReads = new Set<string>();
const settledFirstReads = new Set<string>();

/**
 * Hosts call this during boot with their persistence backend. Persisted UI
 * stores are created at module-evaluation time, which can run before the host
 * composition root has finished, so reads and writes issued before
 * registration wait for the backend instead of treating "not registered yet"
 * as "no saved data". That fallback hydrated every store with defaults and
 * the next write then overwrote the persisted state with those defaults.
 */
export function registerRendererStateStorage(
  storage: RendererStateStorage,
): void {
  hostStorage = storage;
  resolveHostStorage?.(storage);
  resolveHostStorage = null;
}

const deferredHostStorage: StateStorage = {
  getItem: async (key) => {
    const isFirstRead =
      !settledFirstReads.has(key) && !pendingFirstReads.has(key);
    if (isFirstRead) {
      pendingFirstReads.add(key);
    }
    try {
      const storage = hostStorage ?? (await hostStorageReady);
      return await storage.getItem(key);
    } finally {
      if (isFirstRead) {
        pendingFirstReads.delete(key);
        settledFirstReads.add(key);
      }
    }
  },
  setItem: async (key, value) => {
    // A write racing the initial read serializes pre-hydration (default)
    // state, and hydration replaces in-memory state for persisted keys right
    // after. The snapshot is stale either way, so drop it instead of letting
    // it overwrite the values the read is about to return.
    if (pendingFirstReads.has(key)) {
      return;
    }
    const storage = hostStorage ?? (await hostStorageReady);
    await storage.setItem(key, value);
  },
  removeItem: async (key) => {
    const storage = hostStorage ?? (await hostStorageReady);
    await storage.removeItem(key);
  },
};

export const electronStorage = createJSONStorage(() => deferredHostStorage);
