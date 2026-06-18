import { createJSONStorage, type StateStorage } from "zustand/middleware";
import { logger } from "./logger";

export type RendererStateStorage = StateStorage;

const log = logger.scope("renderer-storage");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let hostStorage: RendererStateStorage | null = null;
const hostStorageReady = deferred<RendererStateStorage>();

const pendingFirstReads = new Set<string>();
const settledFirstReads = new Set<string>();

/**
 * Hosts call this during boot with their persistence backend. Persisted UI
 * stores are created at module-evaluation time, which can run before the host
 * composition root has finished, so reads and writes issued before
 * registration wait for the backend instead of treating "not registered yet"
 * as "no saved data". That fallback hydrated every store with defaults and
 * the next write then overwrote the persisted state with those defaults.
 *
 * Registering again replaces the backend for new calls; waiters already in
 * flight settle against the first registration.
 */
export function registerRendererStateStorage(
  storage: RendererStateStorage,
): void {
  hostStorage = storage;
  hostStorageReady.resolve(storage);
}

const deferredHostStorage: StateStorage = {
  getItem: async (key) => {
    const isFirstRead =
      !settledFirstReads.has(key) && !pendingFirstReads.has(key);
    if (isFirstRead) {
      pendingFirstReads.add(key);
    }
    try {
      const storage = hostStorage ?? (await hostStorageReady.promise);
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
    try {
      const storage = hostStorage ?? (await hostStorageReady.promise);
      await storage.setItem(key, value);
    } catch (error) {
      // zustand persist fires writes without awaiting them; a rejection here
      // would only surface as an unhandled rejection.
      log.error("Failed to persist state", { key, error });
    }
  },
  removeItem: async (key) => {
    // Removal is explicit intent rather than a stale state snapshot, so it is
    // not dropped while the initial read is in flight.
    try {
      const storage = hostStorage ?? (await hostStorageReady.promise);
      await storage.removeItem(key);
    } catch (error) {
      log.error("Failed to remove persisted state", { key, error });
    }
  },
};

export const electronStorage = createJSONStorage(() => deferredHostStorage);
