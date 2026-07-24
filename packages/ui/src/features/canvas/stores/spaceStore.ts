import { create } from "zustand";

/**
 * View state for the Arc-style "spaces" chrome (layout prototype): which
 * channel the sidebar is currently scoped to, which direction the last switch
 * moved (drives the slide), and the two sidebar-body overrides — browsing the
 * full channel list, or holding a draft "new space" chooser. The current space
 * survives navigating to channel-less routes (inbox, activity, settings);
 * selecting any space clears the overrides.
 */
interface SpaceState {
  currentChannelId: string | null;
  /** +1 = moved right in the dot order, -1 = left. Drives the slide-in. */
  direction: 1 | -1;
  /** Sidebar body shows the all-channels list (the "#" toggle). */
  browsing: boolean;
  /** Sidebar body shows the new-space chooser (the "+" draft, Arc-style). */
  draftSpace: boolean;
  setCurrentChannel: (channelId: string | null, direction?: 1 | -1) => void;
  setBrowsing: (browsing: boolean) => void;
  setDraftSpace: (draftSpace: boolean) => void;
}

export const useSpaceStore = create<SpaceState>()((set) => ({
  currentChannelId: null,
  direction: 1,
  browsing: false,
  draftSpace: false,
  // Landing in a space always dismisses the overrides — they are transient
  // pickers, not places.
  setCurrentChannel: (currentChannelId, direction) =>
    set((state) => ({
      currentChannelId,
      direction: direction ?? state.direction,
      browsing: false,
      draftSpace: false,
    })),
  setBrowsing: (browsing) =>
    set((state) => ({
      browsing,
      draftSpace: browsing ? false : state.draftSpace,
    })),
  setDraftSpace: (draftSpace) =>
    set((state) => ({
      draftSpace,
      browsing: draftSpace ? false : state.browsing,
    })),
}));
