import {
  parseTimestamps,
  type TaskTimestamps,
} from "@posthog/core/sidebar/taskMeta";
import { resolveService } from "@posthog/di/container";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";

export type { TaskTimestamps };

function workspace() {
  return resolveService<HostTrpcClient>(HOST_TRPC_CLIENT).workspace;
}

export const taskViewedApi = {
  async loadTimestamps(): Promise<Record<string, TaskTimestamps>> {
    return parseTimestamps(await workspace().getAllTaskTimestamps.query());
  },

  markAsViewed(taskId: string): void {
    void workspace().markViewed.mutate({ taskId });
  },

  markActivity(taskId: string): void {
    void workspace().markActivity.mutate({ taskId });
  },
};

export const pinnedTasksApi = {
  async getPinnedTaskIds(): Promise<string[]> {
    return workspace().getPinnedTaskIds.query();
  },

  async togglePin(
    taskId: string,
  ): Promise<{ taskId: string; isPinned: boolean }> {
    const result = await workspace().togglePin.mutate({ taskId });
    return { taskId, isPinned: result.isPinned };
  },

  async unpin(taskId: string): Promise<void> {
    const result = await workspace().togglePin.mutate({ taskId });
    if (result.isPinned) {
      await workspace().togglePin.mutate({ taskId });
    }
  },

  isPinned(pinnedTaskIds: Set<string>, taskId: string): boolean {
    return pinnedTaskIds.has(taskId);
  },
};
