import { create } from "zustand";

interface SessionViewState {
  showRawLogs: boolean;
  searchQuery: string;
  showSearch: boolean;
  /**
   * Ephemeral per-tool-group expand overrides for the new thread, keyed by
   * group id. `true` = expanded, `false` = collapsed, absent = follow the
   * global collapse mode. Not persisted; wiped when the global mode changes.
   */
  groupOverrides: Record<string, boolean>;
}

interface SessionViewActions {
  setShowRawLogs: (show: boolean) => void;
  setSearchQuery: (query: string) => void;
  toggleSearch: () => void;
  setGroupOverride: (id: string, expanded: boolean) => void;
  clearGroupOverrides: () => void;
}

type SessionViewStore = SessionViewState & { actions: SessionViewActions };

const useStore = create<SessionViewStore>((set) => ({
  showRawLogs: false,
  searchQuery: "",
  showSearch: false,
  groupOverrides: {},
  actions: {
    setShowRawLogs: (show) => set({ showRawLogs: show }),
    setSearchQuery: (query) => set({ searchQuery: query }),
    toggleSearch: () =>
      set((state) => ({
        showSearch: !state.showSearch,
        searchQuery: state.showSearch ? "" : state.searchQuery,
      })),
    setGroupOverride: (id, expanded) =>
      set((state) => ({
        groupOverrides: { ...state.groupOverrides, [id]: expanded },
      })),
    clearGroupOverrides: () =>
      set((state) =>
        Object.keys(state.groupOverrides).length === 0
          ? state
          : { groupOverrides: {} },
      ),
  },
}));

export const useShowRawLogs = () => useStore((s) => s.showRawLogs);
export const useSearchQuery = () => useStore((s) => s.searchQuery);
export const useShowSearch = () => useStore((s) => s.showSearch);
export const useGroupOverrides = () => useStore((s) => s.groupOverrides);
export const useSessionViewActions = () => useStore((s) => s.actions);
