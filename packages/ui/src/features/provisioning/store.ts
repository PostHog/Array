import { appendOutputChunk } from "@posthog/core/provisioning/output";
import { create } from "zustand";

interface ProvisioningStoreState {
  activeTasks: Set<string>;
  output: Record<string, string[]>;
}

interface ProvisioningStoreActions {
  setActive: (taskId: string) => void;
  clear: (taskId: string) => void;
  isActive: (taskId: string) => boolean;
  appendChunk: (taskId: string, chunk: string) => void;
}

type ProvisioningStore = ProvisioningStoreState & ProvisioningStoreActions;

export const useProvisioningStore = create<ProvisioningStore>()((set, get) => ({
  activeTasks: new Set(),
  output: {},

  setActive: (taskId) =>
    set((state) => {
      const next = new Set(state.activeTasks);
      next.add(taskId);
      return { activeTasks: next };
    }),

  clear: (taskId) =>
    set((state) => {
      const next = new Set(state.activeTasks);
      next.delete(taskId);
      const { [taskId]: _removed, ...output } = state.output;
      return { activeTasks: next, output };
    }),

  isActive: (taskId) => get().activeTasks.has(taskId),

  appendChunk: (taskId, chunk) =>
    set((state) => ({
      output: {
        ...state.output,
        [taskId]: appendOutputChunk(state.output[taskId] ?? [], chunk),
      },
    })),
}));
