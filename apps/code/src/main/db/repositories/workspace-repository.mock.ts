import {
  type CreateWorkspaceData,
  type IWorkspaceRepository,
  parseDirectories,
  type Workspace,
} from "./workspace-repository";

export interface MockWorkspaceRepository extends IWorkspaceRepository {
  _workspaces: Map<string, Workspace>;
}

export function createMockWorkspaceRepository(): MockWorkspaceRepository {
  const workspaces = new Map<string, Workspace>();
  const taskIndex = new Map<string, string>();

  const clone = (w: Workspace | null): Workspace | null =>
    w ? { ...w } : null;

  const findLiveByTaskId = (taskId: string): Workspace | undefined => {
    const id = taskIndex.get(taskId);
    return id ? workspaces.get(id) : undefined;
  };

  const updateDirectoriesForTask = (
    taskId: string,
    update: (current: string[]) => string[] | null,
  ) => {
    const w = findLiveByTaskId(taskId);
    if (!w) return;
    const next = update(parseDirectories(w.additionalDirectories));
    if (next === null) return;
    workspaces.set(w.id, {
      ...w,
      additionalDirectories: JSON.stringify(next),
      updatedAt: new Date().toISOString(),
    });
  };

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
        additionalDirectories: "[]",
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
    getAdditionalDirectories: (taskId) =>
      parseDirectories(findLiveByTaskId(taskId)?.additionalDirectories),
    addAdditionalDirectory: (taskId, path) => {
      updateDirectoriesForTask(taskId, (current) =>
        current.includes(path) ? null : [...current, path],
      );
    },
    removeAdditionalDirectory: (taskId, path) => {
      updateDirectoriesForTask(taskId, (current) =>
        current.includes(path) ? current.filter((p) => p !== path) : null,
      );
    },
    deleteAll: () => {
      workspaces.clear();
      taskIndex.clear();
    },
  };
}
