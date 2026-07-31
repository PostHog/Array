import { create } from "zustand";

/**
 * The embedded product page is a NATIVE view that paints above the renderer,
 * so any renderer popover that can overlap its rectangle (menus, pickers)
 * must hide the view while open. This counter is that cooperation point:
 * acquire() on open, release() on close; the slot hides the view while > 0.
 */
interface ProductViewObscuredState {
  count: number;
  acquire: () => void;
  release: () => void;
}

export const useProductViewObscuredStore = create<ProductViewObscuredState>(
  (set) => ({
    count: 0,
    acquire: () => set((state) => ({ count: state.count + 1 })),
    release: () => set((state) => ({ count: Math.max(0, state.count - 1) })),
  }),
);
