import type { Task } from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../stores/authStore";

export const taskKeys = {
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
      )) as Task[];
    },
    enabled: !!client,
  });
}

export function useTask(taskId: string) {
  const client = useAuthStore((state) => state.client);

  return useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: async () => {
      if (!client) throw new Error("Not authenticated");
      return (await client.getTask(taskId)) as Task;
    },
    enabled: !!client && !!taskId,
  });
}

export function useCreateTask() {
  const client = useAuthStore((state) => state.client);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      title,
      description,
      repositoryConfig,
      workflow,
    }: {
      title: string;
      description: string;
      repositoryConfig?: { organization: string; repository: string };
      workflow: string;
    }) => {
      if (!client) throw new Error("Not authenticated");
      const task = (await client.createTask(
        title,
        description,
        repositoryConfig,
        workflow,
      )) as Task;
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
      return (await client.duplicateTask(taskId)) as Task;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}

export function useRefreshTask() {
  const client = useAuthStore((state) => state.client);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: string) => {
      if (!client) throw new Error("Not authenticated");
      return (await client.getTask(taskId)) as Task;
    },
    onSuccess: (_, taskId) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
    },
  });
}
