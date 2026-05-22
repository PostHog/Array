import type { UserMessageAttachment } from "@features/sessions/components/session-update/UserMessage";
import { create } from "zustand";

export interface PendingTaskPrompt {
  promptText: string;
  attachments: UserMessageAttachment[];
}

interface PendingTaskPromptStore {
  byKey: Record<string, PendingTaskPrompt>;
  set: (key: string, prompt: PendingTaskPrompt) => void;
  get: (key: string) => PendingTaskPrompt | undefined;
  move: (fromKey: string, toKey: string) => void;
  clear: (key: string) => void;
}

export const usePendingTaskPromptStore = create<PendingTaskPromptStore>(
  (set, get) => ({
    byKey: {},
    set: (key, prompt) =>
      set((state) => ({ byKey: { ...state.byKey, [key]: prompt } })),
    get: (key) => get().byKey[key],
    move: (fromKey, toKey) => {
      if (fromKey === toKey) return;
      set((state) => {
        const entry = state.byKey[fromKey];
        if (!entry) return state;
        const { [fromKey]: _removed, ...rest } = state.byKey;
        return { byKey: { ...rest, [toKey]: entry } };
      });
    },
    clear: (key) =>
      set((state) => {
        if (!(key in state.byKey)) return state;
        const { [key]: _removed, ...rest } = state.byKey;
        return { byKey: rest };
      }),
  }),
);

export const pendingTaskPromptStoreApi = {
  set: (key: string, prompt: PendingTaskPrompt) =>
    usePendingTaskPromptStore.getState().set(key, prompt),
  get: (key: string) => usePendingTaskPromptStore.getState().get(key),
  move: (fromKey: string, toKey: string) =>
    usePendingTaskPromptStore.getState().move(fromKey, toKey),
  clear: (key: string) => usePendingTaskPromptStore.getState().clear(key),
};

export function usePendingTaskPrompt(
  key: string | undefined,
): PendingTaskPrompt | undefined {
  return usePendingTaskPromptStore((state) =>
    key ? state.byKey[key] : undefined,
  );
}
