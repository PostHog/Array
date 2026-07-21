import type { Workspace } from "@posthog/shared";

// Per-device cloud-workspace registry for the web host, backed by localStorage.
//
// Desktop persists a workspace row (SQLite) when a cloud task is created, so
// workspace.getAll returns it and the sidebar — whose default view derives its
// task list from the workspace map (computeSummaryIds) — shows the task. The
// browser has no such backend, so this is the scaled-down equivalent: create
// adds a cloud entry, getAll returns the map, delete removes it, and the map
// survives reloads via localStorage. Scope matches desktop: cloud tasks created
// in THIS browser appear in the sidebar.

const STORAGE_KEY = "posthog-code:web-cloud-workspaces";

function load(): Record<string, Workspace> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Workspace>) : {};
  } catch {
    return {};
  }
}

let workspaces: Record<string, Workspace> = load();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces));
  } catch {
    // Best-effort: a storage failure only costs sidebar persistence, not the task.
  }
}

export const webWorkspaceStore = {
  getAll(): Record<string, Workspace> {
    return workspaces;
  },

  /** Register (or overwrite) a cloud workspace for a task. */
  addCloud(taskId: string, branch: string | null, createdAt: string): void {
    workspaces = {
      ...workspaces,
      [taskId]: {
        taskId,
        folderId: "",
        folderPath: "",
        mode: "cloud",
        worktreePath: null,
        worktreeName: null,
        branchName: null,
        baseBranch: branch,
        linkedBranch: null,
        createdAt,
      },
    };
    persist();
  },

  remove(taskId: string): void {
    if (!(taskId in workspaces)) return;
    const { [taskId]: _removed, ...rest } = workspaces;
    workspaces = rest;
    persist();
  },
};
