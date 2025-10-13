import type { AgentDefinition, Workflow, WorkflowStage } from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../stores/authStore";

export const workflowKeys = {
  all: ["workflows"] as const,
  lists: () => [...workflowKeys.all, "list"] as const,
  list: () => [...workflowKeys.lists()] as const,
  details: () => [...workflowKeys.all, "detail"] as const,
  detail: (id: string) => [...workflowKeys.details(), id] as const,
  stages: (workflowId: string) =>
    [...workflowKeys.all, "stages", workflowId] as const,
};

export const agentKeys = {
  all: ["agents"] as const,
  list: () => [...agentKeys.all, "list"] as const,
};

export function useWorkflows() {
  const client = useAuthStore((state) => state.client);

  return useQuery({
    queryKey: workflowKeys.list(),
    queryFn: async () => {
      if (!client) throw new Error("Not authenticated");
      return (await client.getWorkflows()) as Workflow[];
    },
    enabled: !!client,
  });
}

export function useWorkflowStages(workflowId: string) {
  const client = useAuthStore((state) => state.client);

  return useQuery({
    queryKey: workflowKeys.stages(workflowId),
    queryFn: async () => {
      if (!client) throw new Error("Not authenticated");
      return (await client.getWorkflowStages(workflowId)) as WorkflowStage[];
    },
    enabled: !!client && !!workflowId,
  });
}

export function useAgents() {
  const client = useAuthStore((state) => state.client);

  return useQuery({
    queryKey: agentKeys.list(),
    queryFn: async () => {
      if (!client) throw new Error("Not authenticated");
      return (await client.getAgents()) as AgentDefinition[];
    },
    enabled: !!client,
  });
}

export function useCreateWorkflow() {
  const client = useAuthStore((state) => state.client);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      color?: string;
      is_default?: boolean;
    }) => {
      if (!client) throw new Error("Not authenticated");
      return (await client.createWorkflow(data)) as Workflow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.lists() });
    },
  });
}

export function useUpdateWorkflow() {
  const client = useAuthStore((state) => state.client);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      workflowId,
      data,
    }: {
      workflowId: string;
      data: {
        name?: string;
        description?: string;
        color?: string;
        is_default?: boolean;
        is_active?: boolean;
      };
    }) => {
      if (!client) throw new Error("Not authenticated");
      return (await client.updateWorkflow(workflowId, data)) as Workflow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.lists() });
    },
  });
}

export function useDeactivateWorkflow() {
  const client = useAuthStore((state) => state.client);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (workflowId: string) => {
      if (!client) throw new Error("Not authenticated");
      await client.deactivateWorkflow(workflowId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.lists() });
    },
  });
}

export function useCreateStage() {
  const client = useAuthStore((state) => state.client);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      workflowId,
      data,
    }: {
      workflowId: string;
      data: {
        name: string;
        key: string;
        position: number;
        color?: string;
        agent_name?: string | null;
        is_manual_only?: boolean;
      };
    }) => {
      if (!client) throw new Error("Not authenticated");
      return (await client.createStage(workflowId, data)) as WorkflowStage;
    },
    onSuccess: (_, { workflowId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: workflowKeys.stages(workflowId),
      });
    },
  });
}

export function useUpdateStage() {
  const client = useAuthStore((state) => state.client);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      workflowId,
      stageId,
      data,
    }: {
      workflowId: string;
      stageId: string;
      data: {
        name?: string;
        key?: string;
        position?: number;
        color?: string;
        agent_name?: string | null;
        is_manual_only?: boolean;
        is_archived?: boolean;
      };
    }) => {
      if (!client) throw new Error("Not authenticated");
      return (await client.updateStage(
        workflowId,
        stageId,
        data,
      )) as WorkflowStage;
    },
    onSuccess: (_, { workflowId }) => {
      queryClient.invalidateQueries({ queryKey: workflowKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: workflowKeys.stages(workflowId),
      });
    },
  });
}
