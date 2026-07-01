import type { AgentSession, WorkspaceMode } from "@posthog/shared";
import type { Task } from "@posthog/shared/domain-types";
import { isBrainrotCell } from "./grid";
import { type CellStatus, deriveStatus, getRepoName } from "./status";

export interface CommandCenterCellData {
  cellIndex: number;
  taskId: string | null;
  task: Task | undefined;
  session: AgentSession | undefined;
  status: CellStatus;
  repoName: string | null;
  workspaceMode: WorkspaceMode | null;
  // Brainrot: a looping video slot rather than a task.
  isBrainrot: boolean;
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
  return storeCells.map((cellValue, cellIndex) => {
    if (isBrainrotCell(cellValue)) {
      return {
        cellIndex,
        taskId: null,
        task: undefined,
        session: undefined,
        status: "idle" as const,
        repoName: null,
        workspaceMode: null,
        isBrainrot: true,
      };
    }

    const taskId = cellValue;
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
      isBrainrot: false,
    };
  });
}
