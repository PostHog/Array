import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ChannelTasksState {
  /** Task IDs created within each channel, keyed by channelId, recent first. */
  taskIdsByChannel: Record<string, string[]>;
  addTask: (channelId: string, taskId: string) => void;
  removeTask: (channelId: string, taskId: string) => void;
  removeChannel: (channelId: string) => void;
}

// Tracks which tasks were created from each channel so they can be listed in
// the channel's sub-nav and reopened at /website/$channelId/tasks/$taskId.
// There's no backend task↔channel binding yet — membership lives here, local.
export const useChannelTasksStore = create<ChannelTasksState>()(
  persist(
    (set) => ({
      taskIdsByChannel: {},
      addTask: (channelId, taskId) =>
        set((state) => ({
          taskIdsByChannel: {
            ...state.taskIdsByChannel,
            [channelId]: [
              taskId,
              ...(state.taskIdsByChannel[channelId] ?? []).filter(
                (id) => id !== taskId,
              ),
            ],
          },
        })),
      removeTask: (channelId, taskId) =>
        set((state) => ({
          taskIdsByChannel: {
            ...state.taskIdsByChannel,
            [channelId]: (state.taskIdsByChannel[channelId] ?? []).filter(
              (id) => id !== taskId,
            ),
          },
        })),
      removeChannel: (channelId) =>
        set((state) => {
          const next = { ...state.taskIdsByChannel };
          delete next[channelId];
          return { taskIdsByChannel: next };
        }),
    }),
    { name: "code:channel-tasks" },
  ),
);

const EMPTY: string[] = [];

/** Task IDs for a single channel (stable empty ref when none). */
export function useChannelTaskIds(channelId: string | undefined): string[] {
  return useChannelTasksStore((s) =>
    channelId ? (s.taskIdsByChannel[channelId] ?? EMPTY) : EMPTY,
  );
}
