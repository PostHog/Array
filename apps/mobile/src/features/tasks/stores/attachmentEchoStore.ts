import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { SessionNotificationAttachment } from "../types";

/**
 * Echoes of user messages that carried attachments, keyed by `taskRunId`.
 * Persisted to disk so that re-entering a task — which discards the
 * in-memory session and re-reads history from S3 — can still render the
 * attachments the user sent locally. The cloud log doesn't surface attachment
 * data on `user_message_chunk` events, so without this cache they would
 * disappear after the screen unmounts.
 *
 * Entries are pushed in send-order. Re-hydration matches them positionally
 * against the historical `user_message_chunk` events (Nth user message gets
 * the Nth recorded echo) with a text-equality guard to degrade gracefully if
 * the orders ever diverge.
 */
export interface AttachmentEcho {
  text: string;
  attachments: SessionNotificationAttachment[];
}

interface AttachmentEchoState {
  echoes: Record<string, AttachmentEcho[]>;
  recordEcho: (
    taskRunId: string,
    text: string,
    attachments: SessionNotificationAttachment[],
  ) => void;
  getEchoes: (taskRunId: string) => AttachmentEcho[];
  clearEchoes: (taskRunId: string) => void;
}

export const useAttachmentEchoStore = create<AttachmentEchoState>()(
  persist(
    (set, get) => ({
      echoes: {},
      recordEcho: (taskRunId, text, attachments) => {
        if (attachments.length === 0) return;
        set((state) => {
          const existing = state.echoes[taskRunId] ?? [];
          return {
            echoes: {
              ...state.echoes,
              [taskRunId]: [...existing, { text, attachments }],
            },
          };
        });
      },
      getEchoes: (taskRunId) => get().echoes[taskRunId] ?? [],
      clearEchoes: (taskRunId) => {
        set((state) => {
          const { [taskRunId]: _, ...rest } = state.echoes;
          return { echoes: rest };
        });
      },
    }),
    {
      name: "posthog-attachment-echoes",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ echoes: state.echoes }),
    },
  ),
);
