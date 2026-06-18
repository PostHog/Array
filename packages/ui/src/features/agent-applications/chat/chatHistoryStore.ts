import { electronStorage } from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Locally-persisted index of preview chats the user started against an agent
 * *from this app*. These are the only sessions surfaced in the chat pane's
 * rail — deliberately NOT the agent's full server session list, which can
 * include real customer conversations. Keyed by agent slug; each entry is just
 * enough to re-attach (`/listen` replays the transcript) and label the rail.
 */
export interface PreviewChatEntry {
  sessionId: string;
  /** First user message of the chat, for the rail label. */
  title: string;
  /** Epoch ms when the chat was started here. */
  startedAt: number;
  /**
   * Revision the chat targets, when the user opened it as a draft preview.
   * Undefined for sessions that ran against `live_revision`. Lets the rail
   * label drafts and route resumes back to the right preview surface.
   */
  revisionId?: string;
}

interface ChatHistoryState {
  byAgent: Record<string, PreviewChatEntry[]>;
  /** Record (or move-to-top) a preview chat the user started here. */
  record: (agentKey: string, entry: PreviewChatEntry) => void;
  remove: (agentKey: string, sessionId: string) => void;
}

/** Per-agent cap; preview chats are throwaway, so an old tail is fine to drop. */
const MAX_PER_AGENT = 50;

export const useChatHistoryStore = create<ChatHistoryState>()(
  persist(
    (set) => ({
      byAgent: {},
      record: (agentKey, entry) =>
        set((s) => {
          const existing = s.byAgent[agentKey] ?? [];
          // Newest first, de-duped by sessionId, capped.
          const next = [
            entry,
            ...existing.filter((e) => e.sessionId !== entry.sessionId),
          ].slice(0, MAX_PER_AGENT);
          return { byAgent: { ...s.byAgent, [agentKey]: next } };
        }),
      remove: (agentKey, sessionId) =>
        set((s) => ({
          byAgent: {
            ...s.byAgent,
            [agentKey]: (s.byAgent[agentKey] ?? []).filter(
              (e) => e.sessionId !== sessionId,
            ),
          },
        })),
    }),
    { name: "agent-preview-chats", storage: electronStorage },
  ),
);
