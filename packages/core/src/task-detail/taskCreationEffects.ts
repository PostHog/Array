import type { TaskCreationInput, TaskCreationOutput } from "@posthog/shared";
import type { Task, TaskRun } from "@posthog/shared/domain-types";

/**
 * Host-side reactions to a successful task-creation: optimistic workspace
 * query-cache update, cache invalidation, and the cross-store "last used"
 * settings + draft clearing. The renderer adapter wires these to React-Query
 * and the zustand stores; core stays free of both.
 */
export interface TaskCreationEffects {
  onWorkspaceCreated(output: TaskCreationOutput): void;
  onCreateSuccess(output: TaskCreationOutput, input?: TaskCreationInput): void;
  onRunResumed(taskId: string, run: TaskRun): void;
  /**
   * The saga surfaced the task to the UI (onTaskReady) but a later step
   * failed and rolled the task back (best-effort server-side delete), while
   * caches seeded at ready-time still hold it. Undo those seeds and refetch —
   * if the delete itself failed, the refetch restores the surviving task.
   */
  onCreateRolledBack(task: Task): void;
}
