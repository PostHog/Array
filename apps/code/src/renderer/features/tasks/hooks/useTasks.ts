import { pinnedTasksApi } from "@features/sidebar/hooks/usePinnedTasks";
import { workspaceApi } from "@features/workspace/hooks/useWorkspace";
import { useAuthenticatedMutation } from "@hooks/useAuthenticatedMutation";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import { useMeQuery } from "@hooks/useMeQuery";
import type { Schemas } from "@renderer/api/generated";
import { useFocusStore } from "@renderer/stores/focusStore";
import { useNavigationStore } from "@renderer/stores/navigationStore";
import { trpcClient } from "@renderer/trpc/client";
import type { Task } from "@shared/types";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { useCallback } from "react";

const log = logger.scope("tasks");

const TASK_LIST_POLL_INTERVAL_MS = 30_000;

const taskKeys = {
  all: ["tasks"] as const,
  lists: () => [...taskKeys.all, "list"] as const,
  list: (filters?: {
    repository?: string;
    createdBy?: number;
    originProduct?: string;
    internal?: boolean;
  }) => [...taskKeys.lists(), filters] as const,
  summaries: (ids: string[]) =>
    [...taskKeys.all, "summaries", [...ids].sort()] as const,
  details: () => [...taskKeys.all, "detail"] as const,
  detail: (id: string) => [...taskKeys.details(), id] as const,
};

export function useTasks(
  filters?: {
    repository?: string;
    showAllUsers?: boolean;
    showInternal?: boolean;
  },
  options?: { enabled?: boolean },
) {
  const { data: currentUser } = useMeQuery();
  const createdBy = filters?.showAllUsers ? undefined : currentUser?.id;
  const internal = filters?.showInternal ? true : undefined;

  return useAuthenticatedQuery(
    taskKeys.list({ repository: filters?.repository, createdBy, internal }),
    (client) =>
      client.getTasks({
        repository: filters?.repository,
        createdBy,
        internal,
      }) as unknown as Promise<Task[]>,
    {
      enabled: (options?.enabled ?? true) && !!currentUser?.id,
      refetchInterval: TASK_LIST_POLL_INTERVAL_MS,
    },
  );
}

export function useTaskSummaries(
  ids: string[],
  options?: { enabled?: boolean },
) {
  return useAuthenticatedQuery<Schemas.TaskSummary[]>(
    taskKeys.summaries(ids),
    (client) => client.getTaskSummaries(ids),
    {
      enabled: (options?.enabled ?? true) && ids.length > 0,
      refetchInterval: TASK_LIST_POLL_INTERVAL_MS,
      placeholderData: keepPreviousData,
    },
  );
}

export function useCreateTask() {
  const queryClient = useQueryClient();

  const invalidateTasks = (newTask?: Task) => {
    if (newTask) {
      queryClient.setQueriesData<Task[]>(
        { queryKey: taskKeys.lists() },
        (old) => {
          if (!old) return old;
          if (old.some((task) => task.id === newTask.id)) return old;
          return [newTask, ...old];
        },
      );
    }
    queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
  };

  const mutation = useAuthenticatedMutation(
    (
      client,
      {
        description,
        repository,
        github_integration,
      }: {
        description: string;
        repository?: string;
        github_integration?: number;
        createdFrom?: "cli" | "command-menu";
      },
    ) =>
      client.createTask({
        description,
        repository,
        github_integration,
      }) as unknown as Promise<Task>,
    {
      onSuccess: (_task, variables) => {
        track(ANALYTICS_EVENTS.TASK_CREATED, {
          auto_run: false,
          created_from: variables.createdFrom || "cli",
          repository_provider: variables.repository ? "github" : "none",
        });
      },
    },
  );

  return { ...mutation, invalidateTasks };
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useAuthenticatedMutation(
    (
      client,
      {
        taskId,
        updates,
      }: {
        taskId: string;
        updates: Partial<Task>;
      },
    ) =>
      client.updateTask(
        taskId,
        updates as Parameters<typeof client.updateTask>[1],
      ),
    {
      onSuccess: (_, { taskId }) => {
        queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
        queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      },
    },
  );
}

interface DeleteTaskOptions {
  taskId: string;
  taskTitle: string;
  hasWorktree: boolean;
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  const { view, navigateToTaskInput } = useNavigationStore();

  const mutation = useAuthenticatedMutation(
    async (client, taskId: string) => {
      const focusStore = useFocusStore.getState();
      const workspace = await workspaceApi.get(taskId);

      if (workspace) {
        if (
          focusStore.session?.worktreePath === workspace.worktreePath &&
          workspace.worktreePath
        ) {
          log.info("Unfocusing workspace before deletion");
          await focusStore.disableFocus();
        }

        try {
          await workspaceApi.delete(taskId, workspace.folderPath);
        } catch (error) {
          log.error("Failed to delete workspace:", error);
        }
      }

      return client.deleteTask(taskId);
    },
    {
      onMutate: async (taskId) => {
        // Cancel outgoing refetches to avoid overwriting optimistic update
        await queryClient.cancelQueries({ queryKey: taskKeys.lists() });

        // Snapshot all task list queries for rollback
        const previousQueries: Array<{ queryKey: unknown; data: Task[] }> = [];
        const queries = queryClient.getQueriesData<Task[]>({
          queryKey: taskKeys.lists(),
        });
        for (const [queryKey, data] of queries) {
          if (data) {
            previousQueries.push({ queryKey, data });
          }
        }

        // Optimistically remove the task from all list queries
        queryClient.setQueriesData<Task[]>(
          { queryKey: taskKeys.lists() },
          (old) => old?.filter((task) => task.id !== taskId),
        );

        return { previousQueries };
      },
      onError: (_err, _taskId, context) => {
        // Rollback all queries on error
        const ctx = context as
          | {
              previousQueries: Array<{
                queryKey: readonly unknown[];
                data: Task[];
              }>;
            }
          | undefined;
        if (ctx?.previousQueries) {
          for (const { queryKey, data } of ctx.previousQueries) {
            queryClient.setQueryData(queryKey, data);
          }
        }
      },
      onSettled: () => {
        // Always refetch to ensure sync with server
        queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      },
    },
  );

  const deleteWithConfirm = useCallback(
    async ({ taskId, taskTitle, hasWorktree }: DeleteTaskOptions) => {
      const result = await trpcClient.contextMenu.confirmDeleteTask.mutate({
        taskTitle,
        hasWorktree,
      });

      if (!result.confirmed) {
        return false;
      }

      // Navigate away if viewing the deleted task
      if (view.type === "task-detail" && view.data?.id === taskId) {
        navigateToTaskInput();
      }

      pinnedTasksApi.unpin(taskId);

      await mutation.mutateAsync(taskId);

      return true;
    },
    [mutation, view, navigateToTaskInput],
  );

  return { ...mutation, deleteWithConfirm };
}
