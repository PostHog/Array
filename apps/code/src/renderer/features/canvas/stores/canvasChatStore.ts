import { CANVAS_SYSTEM_PROMPT } from "@features/canvas/genui/catalog";
import type { Spec } from "@json-render/react";
import { trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { create } from "zustand";

const log = logger.scope("canvas-chat-store");

// Single canvas thread for now (the /website canvas).
export const CANVAS_WEBSITE_THREAD = "website";

export interface CanvasMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  spec: Spec | null;
}

interface CanvasChatState {
  threadId: string;
  messages: CanvasMessage[];
  /** Latest assistant-generated spec rendered on the canvas. */
  spec: Spec | null;
  isStreaming: boolean;
  lastTool: string | null;
  error: string | null;

  send: (prompt: string) => Promise<void>;
  reset: () => Promise<void>;

  // Stream handlers, driven by the subscription registrar.
  appendProse: (text: string) => void;
  setSpec: (spec: Spec) => void;
  noteTool: (toolName: string, status: string) => void;
  finish: () => void;
  fail: (message: string) => void;
}

function newId(): string {
  return crypto.randomUUID();
}

export const useCanvasChatStore = create<CanvasChatState>()((set, get) => ({
  threadId: CANVAS_WEBSITE_THREAD,
  messages: [],
  spec: null,
  isStreaming: false,
  lastTool: null,
  error: null,

  send: async (prompt: string) => {
    const text = prompt.trim();
    if (!text || get().isStreaming) return;

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
    set((s) => ({
      messages: [...s.messages, userMessage, assistantMessage],
      isStreaming: true,
      error: null,
      lastTool: null,
    }));

    try {
      await trpcClient.canvasGen.generate.mutate({
        threadId: get().threadId,
        prompt: text,
        systemPrompt: CANVAS_SYSTEM_PROMPT,
      });
    } catch (error) {
      log.error("Canvas generate failed", { error });
      get().fail(error instanceof Error ? error.message : String(error));
    }
  },

  reset: async () => {
    const threadId = get().threadId;
    set({ messages: [], spec: null, isStreaming: false, error: null });
    await trpcClient.canvasGen.reset.mutate({ threadId }).catch(() => {});
  },

  appendProse: (text: string) => {
    set((s) => ({ messages: appendToLastAssistant(s.messages, text) }));
  },

  setSpec: (spec: Spec) => {
    set((s) => ({
      spec,
      messages: s.messages.map((m, i) =>
        i === s.messages.length - 1 && m.role === "assistant"
          ? { ...m, spec }
          : m,
      ),
    }));
  },

  noteTool: (toolName: string, status: string) => {
    set({ lastTool: status === "completed" ? null : toolName });
  },

  finish: () => set({ isStreaming: false, lastTool: null }),

  fail: (message: string) =>
    set({ isStreaming: false, lastTool: null, error: message }),
}));

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
