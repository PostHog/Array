import type {
  CreateWorkspaceData,
  IWorkspaceRepository,
  Workspace,
} from "./workspace-repository";

export interface MockWorkspaceRepository extends IWorkspaceRepository {
  _workspaces: Map<string, Workspace>;
}

export function createMockWorkspaceRepository(): MockWorkspaceRepository {
  const workspaces = new Map<string, Workspace>();
  const taskIndex = new Map<string, string>();

  const clone = (w: Workspace | null): Workspace | null =>
    w ? { ...w } : null;

  return {
    _workspaces: workspaces,
    findById: (id: string) => clone(workspaces.get(id) ?? null),
    findByTaskId: (taskId: string) => {
      const id = taskIndex.get(taskId);
      return clone(id ? (workspaces.get(id) ?? null) : null);
    },
    findAllByRepositoryId: (repositoryId: string) =>
      Array.from(workspaces.values())
        .filter((w) => w.repositoryId === repositoryId)
        .map((w) => ({ ...w })),
    findAllPinned: () =>
      Array.from(workspaces.values())
        .filter((w) => w.pinnedAt !== null)
        .map((w) => ({ ...w })),
    findAll: () => Array.from(workspaces.values()).map((w) => ({ ...w })),
    create: (data: CreateWorkspaceData) => {
      const now = new Date().toISOString();
      const workspace: Workspace = {
        id: crypto.randomUUID(),
        taskId: data.taskId,
        repositoryId: data.repositoryId,
        mode: data.mode,
        pinnedAt: null,
        lastViewedAt: null,
        lastActivityAt: null,
        linkedBranch: null,
        createdAt: now,
        updatedAt: now,
      };
      workspaces.set(workspace.id, workspace);
      taskIndex.set(workspace.taskId, workspace.id);
      return { ...workspace };
    },
    deleteByTaskId: (taskId: string) => {
      const id = taskIndex.get(taskId);
      if (id) {
        workspaces.delete(id);
        taskIndex.delete(taskId);
      }
    },
    deleteById: (id: string) => {
      const workspace = workspaces.get(id);
      if (workspace) {
        taskIndex.delete(workspace.taskId);
        workspaces.delete(id);
      }
    },
    updateLinkedBranch: () => {},
    updatePinnedAt: () => {},
    updateLastViewedAt: () => {},
    updateLastActivityAt: () => {},
    updateMode: () => {},
    setModeAndRepository: (taskId, mode, repositoryId) => {
      const id = taskIndex.get(taskId);
      const existing = id ? workspaces.get(id) : undefined;
      if (!id || !existing) return;
      workspaces.set(id, {
        ...existing,
        mode,
        repositoryId,
        updatedAt: new Date().toISOString(),
      });
    },
    deleteAll: () => {
      workspaces.clear();
      taskIndex.clear();
    },
  };
}
