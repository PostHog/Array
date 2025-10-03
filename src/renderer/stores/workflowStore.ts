import type {
  AgentDefinition,
  Task,
  Workflow,
  WorkflowStage,
} from "@shared/types";
import { create } from "zustand";
import { useAuthStore } from "./authStore";
import { useTaskStore } from "./taskStore";

interface WorkflowState {
  workflows: Workflow[];
  selectedWorkflowId: string | null;
  agents: AgentDefinition[];
  isLoading: boolean;
  error: string | null;

  fetchWorkflows: (options?: { skipLoadingState?: boolean }) => Promise<void>;
  fetchAgents: () => Promise<void>;
  selectWorkflow: (workflowId: string | null) => void;
  getTasksByStage: (workflowId: string) => Map<string, Task[]>;
  createWorkflow: (data: {
    name: string;
    description?: string;
    color?: string;
  }) => Promise<Workflow>;
  updateWorkflow: (
    workflowId: string,
    data: {
      name?: string;
      description?: string;
      color?: string;
    },
  ) => Promise<Workflow>;
  deactivateWorkflow: (workflowId: string) => Promise<void>;
  createStage: (
    workflowId: string,
    data: {
      name: string;
      key: string;
      position: number;
      color?: string;
      agent_name?: string | null;
      is_manual_only?: boolean;
    },
  ) => Promise<WorkflowStage>;
  updateStage: (
    workflowId: string,
    stageId: string,
    data: {
      name?: string;
      key?: string;
      position?: number;
      color?: string;
      agent_name?: string | null;
      is_manual_only?: boolean;
    },
  ) => Promise<WorkflowStage>;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflows: [],
  selectedWorkflowId: null,
  agents: [],
  isLoading: false,
  error: null,

  fetchWorkflows: async (options?: { skipLoadingState?: boolean }) => {
    const client = useAuthStore.getState().client;
    if (!client) return;

    if (!options?.skipLoadingState) {
      set({ isLoading: true, error: null });
    }

    try {
      const workflows = await client.getWorkflows();
      const currentSelection = get().selectedWorkflowId;
      const shouldPreserveSelection =
        currentSelection && workflows.some((w) => w.id === currentSelection);

      set({
        workflows,
        ...(!options?.skipLoadingState && { isLoading: false }),
        selectedWorkflowId: shouldPreserveSelection
          ? currentSelection
          : workflows.find((w) => w.is_active && w.is_default)?.id ||
            workflows[0]?.id,
      });
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to fetch workflows",
        ...(!options?.skipLoadingState && { isLoading: false }),
      });
    }
  },

  fetchAgents: async () => {
    const client = useAuthStore.getState().client;
    if (!client) return;

    try {
      const agents = await client.getAgents();
      set({ agents });
    } catch (error) {
      console.error("Failed to fetch agents:", error);
    }
  },

  selectWorkflow: (workflowId: string | null) => {
    set({ selectedWorkflowId: workflowId });
  },

  getTasksByStage: (workflowId: string) => {
    const tasks = useTaskStore.getState().tasks;
    const workflow = get().workflows.find((w) => w.id === workflowId);

    const tasksByStage = new Map<string, Task[]>();

    if (!workflow) return tasksByStage;

    // Initialize all stages
    workflow.stages
      .filter((stage) => !stage.is_archived)
      .sort((a, b) => a.position - b.position)
      .forEach((stage) => {
        tasksByStage.set(stage.id, []);
      });

    // Group tasks by stage
    tasks.forEach((task) => {
      if (task.workflow === workflowId && task.current_stage) {
        const stageList = tasksByStage.get(task.current_stage);
        if (stageList) {
          stageList.push(task);
        }
      }
    });

    return tasksByStage;
  },

  createWorkflow: async (data) => {
    const client = useAuthStore.getState().client;
    if (!client) throw new Error("Client not available");

    set({ isLoading: true, error: null });

    try {
      const workflow = await client.createWorkflow(data);
      return workflow;
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to create workflow",
        isLoading: false,
      });
      throw error;
    }
  },

  updateWorkflow: async (workflowId, data) => {
    const client = useAuthStore.getState().client;
    if (!client) throw new Error("Client not available");

    set({ isLoading: true, error: null });

    try {
      const workflow = await client.updateWorkflow(workflowId, data);
      await get().fetchWorkflows();
      return workflow;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to update workflow";
      set({ error: errorMessage, isLoading: false });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  deactivateWorkflow: async (workflowId) => {
    const client = useAuthStore.getState().client;
    if (!client) throw new Error("Client not available");

    set({ isLoading: true, error: null });

    try {
      await client.deactivateWorkflow(workflowId);
      await get().fetchWorkflows();
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to deactivate workflow";
      set({ error: errorMessage, isLoading: false });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  createStage: async (workflowId, data) => {
    const client = useAuthStore.getState().client;
    if (!client) throw new Error("Client not available");
    const stage = await client.createStage(workflowId, data);
    await get().fetchWorkflows();
    return stage;
  },

  updateStage: async (workflowId, stageId, data) => {
    const client = useAuthStore.getState().client;
    if (!client) throw new Error("Client not available");

    const stage = await client.updateStage(workflowId, stageId, data);
    await get().fetchWorkflows();
    return stage;
  },
}));
