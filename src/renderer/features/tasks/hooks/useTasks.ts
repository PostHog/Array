import { useTaskExecutionStore } from "@features/tasks/stores/taskExecutionStore";
import { useAuthenticatedMutation } from "@hooks/useAuthenticatedMutation";
import { useAuthenticatedQuery } from "@hooks/useAuthenticatedQuery";
import type { Task } from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";

const taskKeys = {
  all: ["tasks"] as const,
  lists: () => [...taskKeys.all, "list"] as const,
  list: (filters?: { repositoryOrg?: string; repositoryName?: string }) =>
    [...taskKeys.lists(), filters] as const,
  details: () => [...taskKeys.all, "detail"] as const,
  detail: (id: string) => [...taskKeys.details(), id] as const,
};

export function useTasks(filters?: {
  repositoryOrg?: string;
  repositoryName?: string;
}) {
  return useAuthenticatedQuery(
    taskKeys.list(filters),
    (client) =>
      client.getTasks(
        filters?.repositoryOrg,
        filters?.repositoryName,
      ) as unknown as Promise<Task[]>,
  );
}

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useAuthenticatedMutation(
    (
      client,
      {
        description,
        repositoryConfig,
      }: {
        description: string;
        repositoryConfig?: { organization: string; repository: string };
      },
    ) =>
      client.createTask(
        description,
        repositoryConfig,
      ) as unknown as Promise<Task>,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      },
    },
  );
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

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useAuthenticatedMutation(
    (client, taskId: string) => client.deleteTask(taskId),
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      },
    },
  );
}

export function useDuplicateTask() {
  const queryClient = useQueryClient();

  return useAuthenticatedMutation(
    (client, taskId: string) =>
      client.duplicateTask(taskId) as unknown as Promise<Task>,
    {
      onSuccess: (newTask, originalTaskId) => {
        const { getTaskState, setRepoPath } = useTaskExecutionStore.getState();
        const originalState = getTaskState(originalTaskId);

        if (originalState.repoPath) {
          setRepoPath(newTask.id, originalState.repoPath);
        }

        queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      },
    },
  );
}
