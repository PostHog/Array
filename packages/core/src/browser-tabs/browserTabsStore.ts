import type { TabsSnapshot } from "@posthog/shared";
import { createStore } from "zustand/vanilla";

/**
 * Renderer-side mirror of the authoritative tab/window snapshot owned by the
 * main-process BrowserTabsService. Seeded once and kept live via the
 * snapshot-change subscription, so every window reflects one source of truth.
 */
interface BrowserTabsState {
  snapshot: TabsSnapshot;
  setSnapshot: (snapshot: TabsSnapshot) => void;
}

export const browserTabsStore = createStore<BrowserTabsState>((set) => ({
  snapshot: { windows: [], tabs: [] },
  setSnapshot: (snapshot) => set({ snapshot }),
}));

export const getTabsSnapshot = () => browserTabsStore.getState().snapshot;
