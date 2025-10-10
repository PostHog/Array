import type { Task, Workflow } from "@shared/types";
import { create } from "zustand";

interface WorkflowState {
  selectedWorkflowId: string | null;

  selectWorkflow: (workflowId: string | null) => void;
  getTasksByStage: (workflowId: string, workflows: Workflow[], tasks: Task[]) => Map<string, Task[]>;
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  selectedWorkflowId: null,

  selectWorkflow: (workflowId: string | null) => {
    set({ selectedWorkflowId: workflowId });
  },

  getTasksByStage: (workflowId: string, workflows: Workflow[], tasks: Task[]) => {
    const workflow = workflows.find((w) => w.id === workflowId);

    const tasksByStage = new Map<string, Task[]>();

    if (!workflow) return tasksByStage;

    workflow.stages
      .filter((stage) => !stage.is_archived)
      .sort((a, b) => a.position - b.position)
      .forEach((stage) => {
        tasksByStage.set(stage.id, []);
      });

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
