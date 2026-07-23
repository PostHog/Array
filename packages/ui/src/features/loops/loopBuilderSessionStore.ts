import {
  electronStorage,
  flushRendererStateWrites,
} from "@posthog/ui/shell/rendererStorage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface LoopBuilderSession {
  taskId: string;
  prompt: string;
  startedAt: number;
}

export const MAX_BUILDER_SESSIONS = 5;

interface LoopBuilderSessionState {
  sessions: LoopBuilderSession[];
  addSession: (session: LoopBuilderSession) => void;
  removeSession: (taskId: string) => void;
}

export const useLoopBuilderSessionStore = create<LoopBuilderSessionState>()(
  persist(
    (set) => ({
      sessions: [],
      // Flushed immediately: adding is followed by navigating away, and a lost
      // debounced write is exactly the "can't find my builder" bug again.
      addSession: (session) => {
        set((state) => ({
          sessions: [
            session,
            ...state.sessions.filter((s) => s.taskId !== session.taskId),
          ].slice(0, MAX_BUILDER_SESSIONS),
        }));
        void flushRendererStateWrites();
      },
      removeSession: (taskId) => {
        set((state) => ({
          sessions: state.sessions.filter((s) => s.taskId !== taskId),
        }));
        void flushRendererStateWrites();
      },
    }),
    {
      name: "posthog-code-loop-builder-sessions",
      storage: electronStorage,
      partialize: (state) => ({ sessions: state.sessions }),
    },
  ),
);
