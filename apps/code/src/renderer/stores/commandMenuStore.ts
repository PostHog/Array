import { create } from "zustand";

export type CommandMenuScope = "commands" | "tasks";

interface CommandMenuState {
  isOpen: boolean;
  scope: CommandMenuScope;
  open: (scope?: CommandMenuScope) => void;
  close: () => void;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  setScope: (scope: CommandMenuScope) => void;
}

export const useCommandMenuStore = create<CommandMenuState>((set) => ({
  isOpen: false,
  scope: "commands",
  open: (scope = "commands") => set({ isOpen: true, scope }),
  close: () => set({ isOpen: false }),
  toggle: () =>
    set((state) => ({
      isOpen: !state.isOpen,
      // Re-opening via the hotkey always lands on the commands scope.
      scope: state.isOpen ? state.scope : "commands",
    })),
  setOpen: (open) => set({ isOpen: open }),
  setScope: (scope) => set({ scope }),
}));
