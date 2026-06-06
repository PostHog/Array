import { getSessionService } from "@features/sessions/service/service";
import { pinnedTasksApi } from "@features/sidebar/hooks/usePinnedTasks";
import { taskKeys } from "@features/tasks/hooks/taskKeys";
import { workspaceApi } from "@features/workspace/hooks/useWorkspace";
import { useAppView } from "@hooks/useAppView";
import { useAuthenticatedMutation } from "@hooks/useAuthenticatedMutation";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import { useMeQuery } from "@hooks/useMeQuery";
import { openTaskInput } from "@hooks/useOpenTask";
import type { Schemas } from "@renderer/api/generated";
import { useFocusStore } from "@renderer/stores/focusStore";
import { trpcClient } from "@renderer/trpc/client";
import type { Task } from "@shared/types";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { logger } from "@utils/logger";
import { useCallback } from "react";

const log = logger.scope("tasks");

const TASK_LIST_POLL_INTERVAL_MS = 30_000;

function getTaskTitle(
  tasks: Task[] | undefined,
  taskId: string,
): string | undefined {
  return tasks?.find((task) => task.id === taskId)?.title;
}

function getTaskSummaryTitle(
  summaries: Schemas.TaskSummary[] | undefined,
  taskId: string,
): string | undefined {
  return summaries?.find((summary) => summary.id === taskId)?.title;
}

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

// The /tasks/summaries/ endpoint doesn't include origin_product, so fetch the
// slack-origin subset separately and intersect by id in the sidebar. The
// `internal` filter mirrors the sidebar's task-visibility scope so staff
// toggling the internal view still see slack icons on internal tasks.
export function useSlackTasks(options?: {
  enabled?: boolean;
  showInternal?: boolean;
}) {
  const internal = options?.showInternal ? true : undefined;
  return useAuthenticatedQuery<Task[]>(
    taskKeys.list({ originProduct: "slack", internal }),
    (client) =>
      client.getTasks({
        originProduct: "slack",
        internal,
      }) as unknown as Promise<Task[]>,
    {
      enabled: options?.enabled ?? true,
      refetchInterval: TASK_LIST_POLL_INTERVAL_MS,
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
        queryClient.invalidateQueries({ queryKey: taskKeys.allSummaries() });
      },
    },
  );
}

export function useRenameTask() {
  const queryClient = useQueryClient();
  const updateTask = useUpdateTask();

  const renameTask = useCallback(
    async ({
      taskId,
      currentTitle,
      newTitle,
    }: {
      taskId: string;
      currentTitle: string;
      newTitle: string;
    }) => {
      const previousListQueries = queryClient.getQueriesData<Task[]>({
        queryKey: taskKeys.lists(),
      });
      const previousSummaryQueries = queryClient.getQueriesData<
        Schemas.TaskSummary[]
      >({
        queryKey: taskKeys.allSummaries(),
      });
      const previousDetail = queryClient.getQueryData<Task>(
        taskKeys.detail(taskId),
      );

      queryClient.setQueriesData<Task[]>(
        { queryKey: taskKeys.lists() },
        (old) =>
          old?.map((task) =>
            task.id === taskId
              ? { ...task, title: newTitle, title_manually_set: true }
              : task,
          ),
      );
      queryClient.setQueriesData<Schemas.TaskSummary[]>(
        { queryKey: taskKeys.allSummaries() },
        (old) =>
          old?.map((task) =>
            task.id === taskId ? { ...task, title: newTitle } : task,
          ),
      );

      if (previousDetail) {
        queryClient.setQueryData<Task>(taskKeys.detail(taskId), {
          ...previousDetail,
          title: newTitle,
          title_manually_set: true,
        });
      }

      getSessionService().updateSessionTaskTitle(taskId, newTitle);

      try {
        await updateTask.mutateAsync({
          taskId,
          updates: { title: newTitle, title_manually_set: true },
        });
      } catch (error) {
        const shouldRollbackSessionTitle =
          queryClient.getQueryData<Task>(taskKeys.detail(taskId))?.title ===
            newTitle ||
          queryClient
            .getQueriesData<Task[]>({
              queryKey: taskKeys.lists(),
            })
            .some(([, tasks]) => getTaskTitle(tasks, taskId) === newTitle);

        for (const [queryKey, data] of previousListQueries) {
          queryClient.setQueryData<Task[] | undefined>(queryKey, (current) => {
            if (!current) {
              return data;
            }

            return getTaskTitle(current, taskId) === newTitle ? data : current;
          });
        }
        for (const [queryKey, data] of previousSummaryQueries) {
          queryClient.setQueryData<Schemas.TaskSummary[] | undefined>(
            queryKey,
            (current) => {
              if (!current) {
                return data;
              }

              return getTaskSummaryTitle(current, taskId) === newTitle
                ? data
                : current;
            },
          );
        }
        if (previousDetail) {
          queryClient.setQueryData<Task | undefined>(
            taskKeys.detail(taskId),
            (current) => {
              if (!current) {
                return previousDetail;
              }

              return current.title === newTitle ? previousDetail : current;
            },
          );
        }
        if (shouldRollbackSessionTitle) {
          getSessionService().updateSessionTaskTitle(taskId, currentTitle);
        }
        throw error;
      }
    },
    [queryClient, updateTask],
  );

  return {
    renameTask,
    isPending: updateTask.isPending,
  };
}

interface DeleteTaskOptions {
  taskId: string;
  taskTitle: string;
  hasWorktree: boolean;
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  const view = useAppView();

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
      if (view.type === "task-detail" && view.taskId === taskId) {
        openTaskInput();
      }

      pinnedTasksApi.unpin(taskId);

      await mutation.mutateAsync(taskId);

      return true;
    },
    [mutation, view],
  );

  return { ...mutation, deleteWithConfirm };
}
