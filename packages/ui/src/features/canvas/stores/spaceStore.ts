import { create } from "zustand";

/**
 * View state for the spaces chrome: which channel the sidebar is scoped to, the
 * last switch direction (drives the slide), and two mutually-exclusive
 * sidebar-body overrides — `browsing` (the all-channels list) and `draftSpace`
 * (the new-space chooser). The current space survives channel-less routes
 * (inbox, activity, settings); selecting any space clears both overrides.
 */
interface SpaceState {
  currentChannelId: string | null;
  /** +1 = moved right in the dot order, -1 = left. */
  direction: 1 | -1;
  browsing: boolean;
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
