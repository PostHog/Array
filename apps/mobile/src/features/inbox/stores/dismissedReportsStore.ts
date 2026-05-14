import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface DismissedReportsState {
  dismissedIds: string[];
}

interface DismissedReportsActions {
  dismissReport: (reportId: string) => void;
  undismissReport: (reportId: string) => void;
  clearDismissed: () => void;
}

type DismissedReportsStore = DismissedReportsState & DismissedReportsActions;

export const useDismissedReportsStore = create<DismissedReportsStore>()(
  persist(
    (set) => ({
      dismissedIds: [],
      dismissReport: (reportId) =>
        set((state) => ({
          dismissedIds: state.dismissedIds.includes(reportId)
            ? state.dismissedIds
            : [...state.dismissedIds, reportId],
        })),
      undismissReport: (reportId) =>
        set((state) => ({
          dismissedIds: state.dismissedIds.filter((id) => id !== reportId),
        })),
      clearDismissed: () => set({ dismissedIds: [] }),
    }),
    {
      name: "dismissed-reports-storage",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ dismissedIds: state.dismissedIds }),
    },
  ),
);

export const isDismissed = (reportId: string) =>
  useDismissedReportsStore.getState().dismissedIds.includes(reportId);
