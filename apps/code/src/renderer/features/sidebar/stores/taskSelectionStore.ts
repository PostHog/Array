import { create } from "zustand";

interface TaskSelectionState {
  selectedTaskIds: string[];
  /** The last task ID that was clicked — used as the anchor for shift-click range selection. */
  lastClickedId: string | null;
}

interface TaskSelectionActions {
  /** Replace the entire selection (plain click). */
  setSelectedTaskIds: (taskIds: string[]) => void;
  /** Toggle a single task in/out of the selection (cmd-click). */
  toggleTaskSelection: (taskId: string) => void;
  /** Select a contiguous range from the last-clicked task to `toId` within the given ordered list.
   *  Existing selection outside the range is preserved (shift-click behavior).
   *  If there is no last-clicked anchor (e.g. the user just navigated via a plain click),
   *  `fallbackAnchorId` is used — typically the currently active/routed task. */
  selectRange: (
    toId: string,
    orderedIds: string[],
    fallbackAnchorId?: string | null,
  ) => void;
  isTaskSelected: (taskId: string) => boolean;
  clearSelection: () => void;
  pruneSelection: (visibleTaskIds: string[]) => void;
}

type TaskSelectionStore = TaskSelectionState & TaskSelectionActions;

export const useTaskSelectionStore = create<TaskSelectionStore>()(
  (set, get) => ({
    selectedTaskIds: [],
    lastClickedId: null,

    setSelectedTaskIds: (taskIds) =>
      set({
        selectedTaskIds: Array.from(new Set(taskIds)),
        lastClickedId: taskIds.length === 1 ? taskIds[0] : get().lastClickedId,
      }),

    toggleTaskSelection: (taskId) =>
      set((state) => {
        const isRemoving = state.selectedTaskIds.includes(taskId);
        return {
          selectedTaskIds: isRemoving
            ? state.selectedTaskIds.filter((id) => id !== taskId)
            : [...state.selectedTaskIds, taskId],
          lastClickedId: taskId,
        };
      }),

    selectRange: (toId, orderedIds, fallbackAnchorId) =>
      set((state) => {
        const anchorId = state.lastClickedId ?? fallbackAnchorId ?? null;
        if (!anchorId) {
          return { selectedTaskIds: [toId], lastClickedId: toId };
        }
        const anchorIndex = orderedIds.indexOf(anchorId);
        const toIndex = orderedIds.indexOf(toId);
        if (anchorIndex === -1 || toIndex === -1) {
          return { selectedTaskIds: [toId], lastClickedId: toId };
        }
        const start = Math.min(anchorIndex, toIndex);
        const end = Math.max(anchorIndex, toIndex);
        const rangeIds = orderedIds.slice(start, end + 1);
        const merged = Array.from(
          new Set([...state.selectedTaskIds, ...rangeIds]),
        );
        return { selectedTaskIds: merged, lastClickedId: toId };
      }),

    isTaskSelected: (taskId) => get().selectedTaskIds.includes(taskId),

    clearSelection: () => set({ selectedTaskIds: [], lastClickedId: null }),

    pruneSelection: (visibleTaskIds) => {
      const visibleIds = new Set(visibleTaskIds);
      set((state) => {
        const filtered = state.selectedTaskIds.filter((id) =>
          visibleIds.has(id),
        );
        if (filtered.length === state.selectedTaskIds.length) {
          return state;
        }
        return { selectedTaskIds: filtered };
      });
    },
  }),
);
