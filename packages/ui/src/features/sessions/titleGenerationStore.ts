import { create } from "zustand";

/**
 * Chat-title generation bookkeeping, keyed by task id, shared across every
 * mounted chat view of a task.
 *
 * Why this exists: the generator used to track "how many prompts had been seen
 * at the last generation" in refs inside useChatTitleGenerator. Refs reset on
 * every mount, so merely reopening a task whose conversation already had one
 * prompt (or REGENERATE_INTERVAL+) re-fired a fresh LLM title/summary call on
 * each view switch, and two simultaneously mounted views of the same task
 * (embedded chat + logs tab) could double-fire. Keeping the bookkeeping here
 * makes it survive remounts and lets concurrent mounts share one in-flight
 * guard. In-memory only: after an app restart each task gets at most one
 * catch-up generation.
 */
export interface TitleGenerationEntry {
  /** Prompt count of the session when a title/summary was last generated. */
  lastGeneratedAtCount: number;
  /** The task description has been turned into a title once already. */
  initialDescriptionHandled: boolean;
  /** A generation is currently running for this task. */
  inFlight: boolean;
}

const EMPTY_ENTRY: TitleGenerationEntry = {
  lastGeneratedAtCount: 0,
  initialDescriptionHandled: false,
  inFlight: false,
};

interface TitleGenerationStore {
  byTaskId: Record<string, TitleGenerationEntry>;
  update: (taskId: string, patch: Partial<TitleGenerationEntry>) => void;
  reset: () => void;
}

const useTitleGenerationStore = create<TitleGenerationStore>((set) => ({
  byTaskId: {},
  update: (taskId, patch) =>
    set((state) => ({
      byTaskId: {
        ...state.byTaskId,
        [taskId]: { ...(state.byTaskId[taskId] ?? EMPTY_ENTRY), ...patch },
      },
    })),
  reset: () => set({ byTaskId: {} }),
}));

export const titleGenerationStoreApi = {
  get: (taskId: string): TitleGenerationEntry =>
    useTitleGenerationStore.getState().byTaskId[taskId] ?? EMPTY_ENTRY,
  update: (taskId: string, patch: Partial<TitleGenerationEntry>) =>
    useTitleGenerationStore.getState().update(taskId, patch),
  /** Drop all bookkeeping. Intended for tests. */
  reset: () => useTitleGenerationStore.getState().reset(),
};
