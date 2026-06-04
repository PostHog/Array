import { CANVAS_SYSTEM_PROMPT } from "@features/canvas/genui/catalog";
import { isNonEmptySpec } from "@json-render/core";
import type { Spec } from "@json-render/react";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { create } from "zustand";

const log = logger.scope("canvas-chat-store");

export interface CanvasMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  spec: Spec | null;
}

export interface CanvasThreadState {
  messages: CanvasMessage[];
  /** Latest assistant-generated spec rendered on the canvas. */
  spec: Spec | null;
  isStreaming: boolean;
  lastTool: string | null;
  error: string | null;
}

// Stable empty reference so selectors for a missing thread don't churn.
export const EMPTY_THREAD: CanvasThreadState = {
  messages: [],
  spec: null,
  isStreaming: false,
  lastTool: null,
  error: null,
};

interface CanvasChatStore {
  // Threads keyed by id (one per dashboard/canvas surface).
  threads: Record<string, CanvasThreadState>;

  send: (threadId: string, prompt: string) => Promise<void>;
  reset: (threadId: string) => Promise<void>;
  /** Seed a thread's spec from a saved dashboard without clobbering live work. */
  ensureSpec: (threadId: string, spec: Spec) => void;

  // Stream handlers, driven by the subscription registrar.
  appendProse: (threadId: string, text: string) => void;
  setSpec: (threadId: string, spec: Spec) => void;
  noteTool: (threadId: string, toolName: string, status: string) => void;
  finish: (threadId: string) => void;
  fail: (threadId: string, message: string) => void;
}

function newId(): string {
  return crypto.randomUUID();
}

export const useCanvasChatStore = create<CanvasChatStore>()((set, get) => {
  const patch = (
    threadId: string,
    fn: (prev: CanvasThreadState) => CanvasThreadState,
  ) =>
    set((s) => ({
      threads: {
        ...s.threads,
        [threadId]: fn(s.threads[threadId] ?? EMPTY_THREAD),
      },
    }));

  return {
    threads: {},

    send: async (threadId, prompt) => {
      const text = prompt.trim();
      const current = get().threads[threadId] ?? EMPTY_THREAD;
      if (!text || current.isStreaming) return;

      const userMessage: CanvasMessage = {
        id: newId(),
        role: "user",
        text,
        spec: null,
      };
      const assistantMessage: CanvasMessage = {
        id: newId(),
        role: "assistant",
        text: "",
        spec: null,
      };
      patch(threadId, (prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage, assistantMessage],
        isStreaming: true,
        error: null,
        lastTool: null,
      }));

      try {
        await trpcClient.canvasGen.generate.mutate({
          threadId,
          prompt: text,
          systemPrompt: CANVAS_SYSTEM_PROMPT,
        });
      } catch (error) {
        log.error("Canvas generate failed", { error });
        get().fail(
          threadId,
          error instanceof Error ? error.message : String(error),
        );
      }
    },

    reset: async (threadId) => {
      patch(threadId, () => ({ ...EMPTY_THREAD }));
      await trpcClient.canvasGen.reset.mutate({ threadId }).catch(() => {});
    },

    ensureSpec: (threadId, spec) => {
      const cur = get().threads[threadId];
      // Don't overwrite a live stream or edits already in this session — only
      // hydrate an empty thread (e.g. first entry into edit on a saved board).
      if (cur?.isStreaming || isNonEmptySpec(cur?.spec)) return;
      patch(threadId, (prev) => ({ ...prev, spec }));
    },

    appendProse: (threadId, text) => {
      patch(threadId, (prev) => ({
        ...prev,
        messages: appendToLastAssistant(prev.messages, text),
      }));
    },

    setSpec: (threadId, spec) => {
      patch(threadId, (prev) => ({
        ...prev,
        spec,
        messages: prev.messages.map((m, i) =>
          i === prev.messages.length - 1 && m.role === "assistant"
            ? { ...m, spec }
            : m,
        ),
      }));
    },

    noteTool: (threadId, _toolName, status) => {
      patch(threadId, (prev) => ({
        ...prev,
        lastTool: status === "completed" ? null : _toolName,
      }));
    },

    finish: (threadId) => {
      patch(threadId, (prev) => ({
        ...prev,
        isStreaming: false,
        lastTool: null,
      }));
    },

    fail: (threadId, message) => {
      patch(threadId, (prev) => ({
        ...prev,
        isStreaming: false,
        lastTool: null,
        error: message,
      }));
    },
  };
});

/** Subscribe to a single thread's state (stable empty ref when absent). */
export function useCanvasThread(threadId: string): CanvasThreadState {
  return useCanvasChatStore((s) => s.threads[threadId] ?? EMPTY_THREAD);
}

function appendToLastAssistant(
  messages: CanvasMessage[],
  text: string,
): CanvasMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return messages;
  const joined = last.text ? `${last.text}\n${text}` : text;
  return messages.map((m, i) =>
    i === messages.length - 1 ? { ...m, text: joined } : m,
  );
}
