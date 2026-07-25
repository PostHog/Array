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

/**
 * Unscope the sidebar. Callable outside React because the two moments that
 * invalidate a scoped channel — a project switch and a logout — happen in the
 * auth side effects, and `openTaskInput` reads this store to decide where a new
 * task lands. A channel id must never outlive the project it belongs to.
 */
export function resetCurrentChannel(): void {
  useCurrentChannelStore.setState({ currentChannelId: null });
}
