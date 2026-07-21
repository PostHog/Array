// Per-device archived-task registry for the web host, backed by localStorage.
//
// On desktop, archiving is a LOCAL operation: it trashes the task's local
// worktree and records the task in a local archive registry — the task still
// exists on the PostHog server. The cloud-only web host has no worktree, so
// archiving is purely "hide this task from my sidebar on this device", which
// this store persists. Shape mirrors the workspace store (web-workspace-store).

export interface WebArchivedTask {
  taskId: string;
  archivedAt: string;
  folderId: string;
  mode: "worktree" | "local" | "cloud";
  worktreeName: string | null;
  branchName: string | null;
  checkpointId: string | null;
}

const STORAGE_KEY = "posthog-code:web-archived-tasks";

function load(): Record<string, WebArchivedTask> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, WebArchivedTask>) : {};
  } catch {
    return {};
  }
}

let archived: Record<string, WebArchivedTask> = load();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(archived));
  } catch {
    // Best-effort persistence.
  }
}

export const webArchiveStore = {
  list(): WebArchivedTask[] {
    return Object.values(archived);
  },

  ids(): string[] {
    return Object.keys(archived);
  },

  add(taskId: string, archivedAt: string): WebArchivedTask {
    const entry: WebArchivedTask = {
      taskId,
      archivedAt,
      folderId: "",
      mode: "cloud",
      worktreeName: null,
      branchName: null,
      checkpointId: null,
    };
    archived = { ...archived, [taskId]: entry };
    persist();
    return entry;
  },

  remove(taskId: string): void {
    if (!(taskId in archived)) return;
    const { [taskId]: _removed, ...rest } = archived;
    archived = rest;
    persist();
  },
};
