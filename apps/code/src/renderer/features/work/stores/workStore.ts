import { create } from "zustand";

export interface PendingCreateDraft {
  name?: string;
  prompt?: string;
}

interface WorkStoreState {
  /** Draft seed for a brand-new scheduled-task editor session — cleared once consumed. */
  pendingCreateDraft: PendingCreateDraft | null;
}

interface WorkStoreActions {
  setPendingCreateDraft: (draft: PendingCreateDraft | null) => void;
  consumePendingCreateDraft: () => PendingCreateDraft | null;
}

type WorkStore = WorkStoreState & WorkStoreActions;

export const useWorkStore = create<WorkStore>()((set, get) => ({
  pendingCreateDraft: null,
  setPendingCreateDraft: (draft) => set({ pendingCreateDraft: draft }),
  consumePendingCreateDraft: () => {
    const value = get().pendingCreateDraft;
    if (value !== null) set({ pendingCreateDraft: null });
    return value;
  },
}));
