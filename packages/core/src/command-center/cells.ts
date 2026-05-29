import type { AgentSession, WorkspaceMode } from "@posthog/shared";
import type { Task } from "@posthog/shared/domain-types";
import { type CellStatus, deriveStatus, getRepoName } from "./status";

export interface CommandCenterCellData {
  cellIndex: number;
  taskId: string | null;
  task: Task | undefined;
  session: AgentSession | undefined;
  status: CellStatus;
  repoName: string | null;
  workspaceMode: WorkspaceMode | null;
}

export interface BuildCellsInput {
  taskById: Map<string, Task>;
  sessionByTaskId: Map<string, AgentSession>;
  workspaces: Record<string, { mode: WorkspaceMode } | undefined> | undefined;
}

export function buildCommandCenterCells(
  storeCells: (string | null)[],
  input: BuildCellsInput,
): CommandCenterCellData[] {
  const { taskById, sessionByTaskId, workspaces } = input;
  return storeCells.map((taskId, cellIndex) => {
    const task = taskId ? taskById.get(taskId) : undefined;
    const session = taskId ? sessionByTaskId.get(taskId) : undefined;
    const status = taskId ? deriveStatus(session) : "idle";
    const repoName = task ? getRepoName(task) : null;
    const workspaceMode = (taskId ? workspaces?.[taskId]?.mode : null) ?? null;

    return {
      cellIndex,
      taskId,
      task,
      session,
      status,
      repoName,
      workspaceMode,
    };
  });
}
