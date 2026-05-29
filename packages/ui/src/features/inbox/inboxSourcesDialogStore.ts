import { create } from "zustand";

interface InboxSourcesDialogStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useInboxSourcesDialogStore = create<InboxSourcesDialogStore>()(
  (set) => ({
    open: false,
    setOpen: (open) => set({ open }),
  }),
);
