import { create } from "zustand";

interface UpdateModalStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useUpdateModalStore = create<UpdateModalStore>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
