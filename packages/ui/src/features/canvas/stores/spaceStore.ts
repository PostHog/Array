import { create } from "zustand";

/**
 * View state for the Arc-style "spaces" chrome (layout prototype): which
 * channel the sidebar is currently scoped to, and which direction the last
 * switch moved so the sidebar body can slide accordingly. The current space
 * survives navigating to channel-less routes (inbox, activity, settings) so
 * the sidebar keeps its scope until the user explicitly leaves via the
 * all-channels landing.
 */
interface SpaceState {
  currentChannelId: string | null;
  /** +1 = moved right in the dot order, -1 = left. Drives the slide-in. */
  direction: 1 | -1;
  setCurrentChannel: (channelId: string | null, direction?: 1 | -1) => void;
}

export const useSpaceStore = create<SpaceState>()((set) => ({
  currentChannelId: null,
  direction: 1,
  setCurrentChannel: (currentChannelId, direction) =>
    set((state) => ({
      currentChannelId,
      direction: direction ?? state.direction,
    })),
}));
