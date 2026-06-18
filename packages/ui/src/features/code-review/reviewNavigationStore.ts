import { create } from "zustand";

export type ReviewMode = "closed" | "split" | "expanded";

interface ReviewNavigationStoreState {
  activeFilePaths: Record<string, string | null>;
  scrollRequests: Record<string, string | null>;
  reviewModes: Record<string, ReviewMode>;
}

interface ReviewNavigationStoreActions {
  setActiveFilePath: (taskId: string, path: string | null) => void;
  requestScrollToFile: (taskId: string, path: string) => void;
  clearScrollRequest: (taskId: string) => void;
  clearTask: (taskId: string) => void;
  setReviewMode: (taskId: string, mode: ReviewMode) => void;
  getReviewMode: (taskId: string) => ReviewMode;
}

type ReviewNavigationStore = ReviewNavigationStoreState &
  ReviewNavigationStoreActions;

export const useReviewNavigationStore = create<ReviewNavigationStore>()(
  (set, get) => ({
    activeFilePaths: {},
    scrollRequests: {},
    reviewModes: {},

    setActiveFilePath: (taskId, path) =>
      set((state) => ({
        activeFilePaths: { ...state.activeFilePaths, [taskId]: path },
      })),

    requestScrollToFile: (taskId, path) =>
      set((state) => ({
        scrollRequests: { ...state.scrollRequests, [taskId]: path },
      })),

    clearScrollRequest: (taskId) =>
      set((state) => ({
        scrollRequests: { ...state.scrollRequests, [taskId]: null },
      })),

    clearTask: (taskId) =>
      set((state) => ({
        activeFilePaths: { ...state.activeFilePaths, [taskId]: null },
        scrollRequests: { ...state.scrollRequests, [taskId]: null },
      })),

    setReviewMode: (taskId, mode) =>
      set((state) => ({
        reviewModes: { ...state.reviewModes, [taskId]: mode },
      })),

    getReviewMode: (taskId) => get().reviewModes[taskId] ?? "closed",
  }),
);
