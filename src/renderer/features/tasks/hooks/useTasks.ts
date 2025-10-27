import { useAuthStore } from "@features/auth/stores/authStore";
import { useTaskExecutionStore } from "@features/tasks/stores/taskExecutionStore";
import type { Task } from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
  const client = useAuthStore((state) => state.client);

  return useQuery({
    queryKey: taskKeys.list(filters),
    queryFn: async () => {
      if (!client) throw new Error("Not authenticated");
      return (await client.getTasks(
        filters?.repositoryOrg,
        filters?.repositoryName,
      )) as unknown as Task[];
    },
    enabled: !!client,
  });
}

export function useCreateTask() {
  const client = useAuthStore((state) => state.client);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      description,
      repositoryConfig,
    }: {
      description: string;
      repositoryConfig?: { organization: string; repository: string };
    }) => {
      if (!client) throw new Error("Not authenticated");
      const task = (await client.createTask(
        description,
        repositoryConfig,
      )) as unknown as Task;
      return task;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

export function useUpdateTask() {
  const client = useAuthStore((state) => state.client);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      taskId,
      updates,
    }: {
      taskId: string;
      updates: Partial<Task>;
    }) => {
      if (!client) throw new Error("Not authenticated");
      return await client.updateTask(
        taskId,
        updates as Parameters<typeof client.updateTask>[1],
      );
    },
    onSuccess: (_, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
    },
  });
}

export function useDeleteTask() {
  const client = useAuthStore((state) => state.client);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: string) => {
      if (!client) throw new Error("Not authenticated");
      await client.deleteTask(taskId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

export function useDuplicateTask() {
  const client = useAuthStore((state) => state.client);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: string) => {
      if (!client) throw new Error("Not authenticated");
      return (await client.duplicateTask(taskId)) as unknown as Task;
    },
    onSuccess: (newTask, originalTaskId) => {
      // Copy working directory from original task to new task
      const { getTaskState, setRepoPath } = useTaskExecutionStore.getState();
      const originalState = getTaskState(originalTaskId);

      if (originalState.repoPath) {
        setRepoPath(newTask.id, originalState.repoPath);
      }

      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}
