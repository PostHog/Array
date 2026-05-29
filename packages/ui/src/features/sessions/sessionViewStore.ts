import { create } from "zustand";

interface SessionViewState {
  showRawLogs: boolean;
  searchQuery: string;
  showSearch: boolean;
}

interface SessionViewActions {
  setShowRawLogs: (show: boolean) => void;
  setSearchQuery: (query: string) => void;
  toggleSearch: () => void;
}

type SessionViewStore = SessionViewState & { actions: SessionViewActions };

const useStore = create<SessionViewStore>((set) => ({
  showRawLogs: false,
  searchQuery: "",
  showSearch: false,
  actions: {
    setShowRawLogs: (show) => set({ showRawLogs: show }),
    setSearchQuery: (query) => set({ searchQuery: query }),
    toggleSearch: () =>
      set((state) => ({
        showSearch: !state.showSearch,
        searchQuery: state.showSearch ? "" : state.searchQuery,
      })),
  },
}));

export const useShowRawLogs = () => useStore((s) => s.showRawLogs);
export const useSearchQuery = () => useStore((s) => s.searchQuery);
export const useShowSearch = () => useStore((s) => s.showSearch);
export const useSessionViewActions = () => useStore((s) => s.actions);
