import { create } from "zustand";

/**
 * The channel the sidebar is currently scoped to. Survives channel-less routes
 * (inbox, activity, settings).
 */
interface CurrentChannelState {
  currentChannelId: string | null;
  setCurrentChannel: (channelId: string | null) => void;
}

export const useCurrentChannelStore = create<CurrentChannelState>()((set) => ({
  currentChannelId: null,
  setCurrentChannel: (currentChannelId) => set({ currentChannelId }),
}));
