import { resolveService } from "@posthog/di/container";
import { createJSONStorage, type StateStorage } from "zustand/middleware";

export interface RendererStateStorage extends StateStorage {}

export const RENDERER_STATE_STORAGE = Symbol.for(
  "posthog.ui.RendererStateStorage",
);

function rawStorage(): StateStorage | null {
  try {
    return resolveService<RendererStateStorage>(RENDERER_STATE_STORAGE);
  } catch {
    return null;
  }
}

const lazyStorage: StateStorage = {
  getItem: (key) => {
    const storage = rawStorage();
    return storage ? storage.getItem(key) : null;
  },
  setItem: (key, value) => {
    const storage = rawStorage();
    return storage ? storage.setItem(key, value) : undefined;
  },
  removeItem: (key) => {
    const storage = rawStorage();
    return storage ? storage.removeItem(key) : undefined;
  },
};

export const rendererSecureStore: StateStorage = lazyStorage;

export const electronStorage = createJSONStorage(() => lazyStorage);
