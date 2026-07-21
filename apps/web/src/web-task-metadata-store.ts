// Per-device task metadata (pins + viewed/activity timestamps) for the web host,
// backed by localStorage. Desktop persists this in a local metadata service
// (workspace.getPinnedTaskIds / togglePin / getAllTaskTimestamps / markViewed /
// markActivity). The archive flow reads pins early (getPinnedTaskIds + unpin),
// so without these the whole archive rejects — hence this store.

export interface TaskMetadata {
  pinnedAt: string | null;
  lastViewedAt: string | null;
  lastActivityAt: string | null;
}

const EMPTY: TaskMetadata = {
  pinnedAt: null,
  lastViewedAt: null,
  lastActivityAt: null,
};

const STORAGE_KEY = "posthog-code:web-task-metadata";

function load(): Record<string, TaskMetadata> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, TaskMetadata>) : {};
  } catch {
    return {};
  }
}

let metadata: Record<string, TaskMetadata> = load();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(metadata));
  } catch {
    // Best-effort persistence.
  }
}

function update(taskId: string, patch: Partial<TaskMetadata>): TaskMetadata {
  const next = { ...(metadata[taskId] ?? EMPTY), ...patch };
  metadata = { ...metadata, [taskId]: next };
  persist();
  return next;
}

export const webTaskMetadataStore = {
  getAll(): Record<string, TaskMetadata> {
    return metadata;
  },

  get(taskId: string): TaskMetadata {
    return metadata[taskId] ?? EMPTY;
  },

  getPinnedTaskIds(): string[] {
    return Object.entries(metadata)
      .filter(([, m]) => m.pinnedAt !== null)
      .map(([taskId]) => taskId);
  },

  togglePin(taskId: string): { isPinned: boolean; pinnedAt: string | null } {
    const current = metadata[taskId] ?? EMPTY;
    const pinnedAt = current.pinnedAt ? null : new Date().toISOString();
    update(taskId, { pinnedAt });
    return { isPinned: pinnedAt !== null, pinnedAt };
  },

  markViewed(taskId: string): void {
    update(taskId, { lastViewedAt: new Date().toISOString() });
  },

  markActivity(taskId: string): void {
    update(taskId, { lastActivityAt: new Date().toISOString() });
  },

  remove(taskId: string): void {
    if (!(taskId in metadata)) return;
    const { [taskId]: _removed, ...rest } = metadata;
    metadata = rest;
    persist();
  },
};
