import { create } from "zustand";

interface WhatsNewStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useWhatsNewStore = create<WhatsNewStore>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
