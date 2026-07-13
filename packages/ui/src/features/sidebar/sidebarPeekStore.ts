import { create } from "zustand";

// Ephemeral hover-peek state for the collapsed sidebar: hovering the left
// gutter or the title-bar toggle slides the sidebar out as an overlay, and
// leaving hides it. Re-entering any trigger before the hide fires keeps the
// peek alive. Not persisted.
interface SidebarPeekStore {
  peek: boolean;
  setPeek: (peek: boolean) => void;
}

export const useSidebarPeekStore = create<SidebarPeekStore>()((set) => ({
  peek: false,
  setPeek: (peek) => set({ peek }),
}));

// The hide timer is shared across every trigger (gutter, toggle button, the
// panel itself) so re-entering any of them keeps the peek alive.
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const clearHideTimer = (): void => {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
};

export function beginSidebarPeek(): void {
  clearHideTimer();
  useSidebarPeekStore.getState().setPeek(true);
}

export function endSidebarPeek(delayMs = 0): void {
  clearHideTimer();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    useSidebarPeekStore.getState().setPeek(false);
  }, delayMs);
}

export function cancelSidebarPeek(): void {
  clearHideTimer();
  useSidebarPeekStore.getState().setPeek(false);
}
