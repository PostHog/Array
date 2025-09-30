import type { Task, Workflow } from "@shared/types";
import { create } from "zustand";
import { useAuthStore } from "./authStore";
import { useTaskStore } from "./taskStore";

interface WorkflowState {
  workflows: Workflow[];
  selectedWorkflowId: string | null;
  isLoading: boolean;
  error: string | null;

  fetchWorkflows: () => Promise<void>;
  selectWorkflow: (workflowId: string | null) => void;
  getTasksByStage: (workflowId: string) => Map<string, Task[]>;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflows: [],
  selectedWorkflowId: null,
  isLoading: false,
  error: null,

  fetchWorkflows: async () => {
    const client = useAuthStore.getState().client;
    if (!client) return;

    set({ isLoading: true, error: null });

    try {
      const workflows = await client.getWorkflows();
      set({
        workflows,
        isLoading: false,
        // Select first active workflow by default
        selectedWorkflowId:
          workflows.find((w) => w.is_active && w.is_default)?.id ||
          workflows[0]?.id,
      });
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Failed to fetch workflows",
        isLoading: false,
      });
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
}));
