import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// Remembers which task is generating (or last attempted to generate) a channel's
// CONTEXT.md, so the CONTEXT.md view can show that task's status — a loading
// link while it runs, or a re-generate option if it stopped without producing a
// file. Persisted (survives reload) since the generating task runs in the
// background and the user may navigate away and return.
interface ContextGenTaskStore {
  /** channelId -> generation taskId */
  tasksByChannel: Record<string, string>;
  setTask: (channelId: string, taskId: string) => void;
  clearTask: (channelId: string) => void;
}

export const useContextGenTaskStore = create<ContextGenTaskStore>()(
  persist(
    (set) => ({
      tasksByChannel: {},
      setTask: (channelId, taskId) =>
        set((s) => ({
          tasksByChannel: { ...s.tasksByChannel, [channelId]: taskId },
        })),
      clearTask: (channelId) =>
        set((s) => {
          if (!(channelId in s.tasksByChannel)) return s;
          const { [channelId]: _removed, ...rest } = s.tasksByChannel;
          return { tasksByChannel: rest };
        }),
    }),
    {
      name: "context-gen-task-storage",
      storage: electronStorage,
      partialize: (s) => ({ tasksByChannel: s.tasksByChannel }),
    },
  ),
);

/** The generation taskId recorded for a channel, or undefined. */
export function useContextGenTaskId(channelId: string): string | undefined {
  return useContextGenTaskStore((s) => s.tasksByChannel[channelId]);
}
