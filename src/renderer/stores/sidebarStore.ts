import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SidebarStore {
  open: boolean;
  width: number;
  isResizing: boolean;
  expandedNodes: string[];
  setOpen: (open: boolean) => void;
  setWidth: (width: number) => void;
  setIsResizing: (isResizing: boolean) => void;
  toggleNode: (nodeId: string) => void;
  expandAll: (allNodeIds: string[]) => void;
  collapseAll: () => void;
}

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      open: true,
      width: 256, // 16rem default
      isResizing: false,
      expandedNodes: ["root", "root.2", "root.3"],
      setOpen: (open) => set({ open }),
      setWidth: (width) => set({ width }),
      setIsResizing: (isResizing) => set({ isResizing }),
      toggleNode: (nodeId) =>
        set((state) => ({
          expandedNodes: state.expandedNodes.includes(nodeId)
            ? state.expandedNodes.filter((id) => id !== nodeId)
            : [...state.expandedNodes, nodeId],
        })),
      expandAll: (allNodeIds) => set({ expandedNodes: allNodeIds }),
      collapseAll: () => set({ expandedNodes: [] }),
    }),
    {
      name: "sidebar-storage",
    },
  ),
);
