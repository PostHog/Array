import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FolderPickerStore {
  recentDirectories: string[];
  lastSelectedFolder: string | null;
  addRecentDirectory: (path: string) => void;
  setLastSelectedFolder: (path: string) => void;
  getFilteredRecent: (query: string) => string[];
}

export const useFolderPickerStore = create<FolderPickerStore>()(
  persist(
    (set, get) => ({
      recentDirectories: [],
      lastSelectedFolder: null,

      addRecentDirectory: (path: string) => {
        if (!path || path.trim().length === 0) return;

        set((state) => {
          const filtered = state.recentDirectories.filter((p) => p !== path);
          const updated = [path, ...filtered].slice(0, 5);
          return { recentDirectories: updated };
        });
      },

      setLastSelectedFolder: (path: string) => {
        set({ lastSelectedFolder: path });
      },

      getFilteredRecent: (query: string) => {
        const state = get();
        if (!query || query.trim().length === 0) {
          return state.recentDirectories;
        }

        const queryLower = query.toLowerCase();
        return state.recentDirectories.filter((path) =>
          path.toLowerCase().includes(queryLower),
        );
      },
    }),
    {
      name: "folder-picker-recent",
    },
  ),
);
