import {
  TASK_SERVICE,
  type TaskService,
} from "@posthog/core/task-detail/taskService";
import { useService } from "@posthog/di/react";
import { useHostTRPCClient } from "@posthog/host-router/react";
import { PROJECT_BLUEBIRD_FLAG } from "@posthog/shared";
import type { Task } from "@posthog/shared/domain-types";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { useChannels } from "@posthog/ui/features/canvas/hooks/useChannels";
import { useTaskChannelMap } from "@posthog/ui/features/canvas/hooks/useTaskChannelMap";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { useTaskViewed } from "@posthog/ui/features/sidebar/useTaskViewed";
import { taskKeys } from "@posthog/ui/features/tasks/taskKeys";
import { toast } from "@posthog/ui/primitives/toast";
import { openTask as openTaskHelper } from "@posthog/ui/router/useOpenTask";
import { logger } from "@posthog/ui/shell/logger";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

const log = logger.scope("task-deep-link");

/**
 * Subscribes to open-existing-task deep link events and opens the task. Uses
 * the TASK_SERVICE bridge (createTask/openTask) to provision the workspace via
 * the saga pattern, so this hook no longer depends on the renderer TaskService.
 */
export function useTaskDeepLink() {
  const client = useHostTRPCClient();
  const taskService = useService<TaskService>(TASK_SERVICE);
  const { markAsViewed } = useTaskViewed();
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStateValue(
    (state) => state.status === "authenticated",
  );
  const hasFetchedPending = useRef(false);

  // A task filed to a Project Bluebird channel opens in the channel-organized
  // view under /website, keeping the channels chrome — mirroring CommandMenu.
  // Gate the channel fetches behind the flag so they never reach ungated users.
  const bluebirdEnabled = useFeatureFlag(
    PROJECT_BLUEBIRD_FLAG,
    import.meta.env.DEV,
  );
  const { channels } = useChannels({ enabled: bluebirdEnabled });
  const channelMap = useTaskChannelMap(channels, { enabled: bluebirdEnabled });
  // Mirror the latest map into a ref so the stable `handleOpenTask` callback can
  // read it without listing the map in its deps — otherwise the callback (and
  // the onOpenTask subscription below) would be recreated on every channel poll.
  const channelMapRef = useRef(channelMap);
  useEffect(() => {
    channelMapRef.current = channelMap;
  }, [channelMap]);

  const handleOpenTask = useCallback(
    async (taskId: string, taskRunId?: string) => {
      log.info(
        `Opening task from deep link: ${taskId}${taskRunId ? `, run: ${taskRunId}` : ""}`,
      );

      try {
        const result = await taskService.openTask(taskId, taskRunId);

        if (!result.success) {
          log.error("Failed to open task from deep link", {
            taskId,
            taskRunId,
            error: result.error,
            failedStep: result.failedStep,
          });
          toast.error(`Failed to open task: ${result.error}`);
          return;
        }

        const { task } = result.data;

        queryClient.setQueryData<Task[]>(taskKeys.list(), (old) => {
          if (!old) return [task];
          const existingIndex = old.findIndex((t) => t.id === task.id);
          if (existingIndex >= 0) {
            const updated = [...old];
            updated[existingIndex] = task;
            return updated;
          }
          return [task, ...old];
        });

        queryClient.invalidateQueries({ queryKey: taskKeys.lists() });

        markAsViewed(taskId);
        const channel = bluebirdEnabled
          ? channelMapRef.current.get(task.id)
          : undefined;
        void openTaskHelper(
          task,
          channel ? { channelId: channel.id } : undefined,
        );

        log.info(
          `Successfully opened task from deep link: ${taskId}${taskRunId ? `, run: ${taskRunId}` : ""}`,
        );
      } catch (error) {
        log.error("Unexpected error opening task from deep link:", error);
        toast.error("Failed to open task");
      }
    },
    [markAsViewed, queryClient, taskService, bluebirdEnabled],
  );

  // Check for pending deep link on mount (for cold start via deep link)
  useEffect(() => {
    if (!isAuthenticated || hasFetchedPending.current) return;

    const fetchPending = async () => {
      hasFetchedPending.current = true;
      try {
        const pending = await client.deepLink.getPendingDeepLink.query();
        if (pending) {
          log.info(
            `Found pending deep link: taskId=${pending.taskId}, taskRunId=${pending.taskRunId ?? "none"}`,
          );
          handleOpenTask(pending.taskId, pending.taskRunId);
        }
      } catch (error) {
        log.error("Failed to check for pending deep link:", error);
      }
    };

    fetchPending();
  }, [isAuthenticated, handleOpenTask, client]);

  // Subscribe to deep link events (for warm start via deep link)
  useEffect(() => {
    const subscription = client.deepLink.onOpenTask.subscribe(undefined, {
      onData: (data) => {
        log.info(
          `Received deep link event: taskId=${data.taskId}, taskRunId=${data.taskRunId ?? "none"}`,
        );
        if (!data?.taskId) return;
        handleOpenTask(data.taskId, data.taskRunId);
      },
    });
    return () => subscription.unsubscribe();
  }, [client, handleOpenTask]);
}
