import { isNonEmptySpec } from "@json-render/core";
import type { Spec } from "@json-render/react";
import type { DashboardDateRange } from "@posthog/core/canvas/dashboardSchemas";
import { dashboardTitleFromSpec } from "@posthog/ui/features/canvas/genui/dashboardTitle";
import { logger } from "@posthog/ui/shell/logger";
import { create } from "zustand";
import { hostClient } from "../hostClient";

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
  /** The canvas template driving the agent (see core/canvas/canvasTemplates). */
  templateId: string;
  /** The time window the agent should build for (toolbar date picker, edit mode). */
  dateRange: DashboardDateRange | null;
  isStreaming: boolean;
  lastTool: string | null;
  error: string | null;
}

// Stable empty reference so selectors for a missing thread don't churn.
export const EMPTY_THREAD: CanvasThreadState = {
  messages: [],
  spec: null,
  templateId: "dashboard",
  dateRange: null,
  isStreaming: false,
  lastTool: null,
  error: null,
};

interface CanvasChatStore {
  // Threads keyed by id (one per dashboard/canvas surface).
  threads: Record<string, CanvasThreadState>;

  send: (threadId: string, prompt: string) => Promise<void>;
  reset: (threadId: string) => Promise<void>;
  /** Set the canvas template driving a thread's agent (from the saved record). */
  setTemplate: (threadId: string, templateId: string) => void;
  /** Set the time window the agent should build for (toolbar date picker). */
  setDateRange: (
    threadId: string,
    dateRange: DashboardDateRange | null,
  ) => void;
  /** Seed a thread's spec from a saved dashboard without clobbering live work. */
  ensureSpec: (threadId: string, spec: Spec) => void;
  /** Inline edit: set a prop on an element (propPath is a pointer like "/title"). */
  setElementProp: (
    threadId: string,
    elementKey: string,
    propPath: string,
    value: unknown,
  ) => void;

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

// Child keys referenced by some element but with no element defined — the cause
// of silently-empty containers. Surfaced to the agent so it can repair them.
function danglingChildKeys(spec: Spec | null): string[] {
  const elements = spec?.elements;
  if (!elements) return [];
  const missing = new Set<string>();
  for (const el of Object.values(elements)) {
    for (const childKey of el.children ?? []) {
      if (!elements[childKey]) missing.add(childKey);
    }
  }
  return [...missing];
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

      // The agent session's system prompt is frozen at session start, so the
      // canvas identity + current contents ride the prompt — keeping the agent
      // anchored to the open board (even after a reload) and letting it append
      // against the real element keys instead of rebuilding from scratch.
      let context: string;
      if (isNonEmptySpec(current.spec)) {
        const title = dashboardTitleFromSpec(current.spec);
        const dangling = danglingChildKeys(current.spec);
        context = [
          `[Context] You are editing the existing canvas${title ? ` titled "${title}"` : ""}. APPEND to it — never recreate or replace existing elements. Reuse the element keys in the spec below; add new elements under new keys and attach them by appending to the relevant container's children.`,
          dangling.length > 0
            ? `BROKEN REFERENCES: these keys are listed as children but have NO element defined: ${dangling.map((k) => `"${k}"`).join(", ")}. Fix each by EITHER defining the missing element (op "add" at /elements/<key>) OR removing the dangling key from its parent's children. Do not leave them dangling.`
            : "",
          "Current canvas spec (json-render):",
          "```json",
          JSON.stringify(current.spec),
          "```",
        ]
          .filter(Boolean)
          .join("\n");
      } else {
        context = "[Context] You are starting a new, untitled canvas.";
      }
      // The agent's system prompt is frozen at session start and the model has no
      // inherent "now", so stamp the current instant on every turn. Templates use
      // it to compute relative windows ("Last 7 days" = now − 7 days).
      const now = new Date();
      const nowLine = `[Now] Current date/time is ${now.toISOString()} (epoch ms ${now.getTime()}), timezone ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;
      // The toolbar date picker's selected window, so the agent collects data for
      // (and seeds state.dateRange to) exactly the range the user is looking at.
      const range = current.dateRange;
      const rangeLine = range
        ? `[Range] Selected window: "${range.name}" from ${new Date(range.from).toISOString()} to ${new Date(range.to).toISOString()} (epoch ms ${range.from}–${range.to}). Build for THIS window.`
        : "";
      const agentPrompt = [nowLine, rangeLine, context, "", text]
        .filter(Boolean)
        .join("\n");

      try {
        await hostClient().canvasGen.generate.mutate({
          threadId,
          prompt: agentPrompt,
          templateId: current.templateId,
          currentSpec: current.spec as Record<string, unknown> | null,
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
      await hostClient()
        .canvasGen.reset.mutate({ threadId })
        .catch(() => {});
    },

    setTemplate: (threadId, templateId) => {
      patch(threadId, (prev) => ({ ...prev, templateId }));
    },

    setDateRange: (threadId, dateRange) => {
      patch(threadId, (prev) => ({ ...prev, dateRange }));
    },

    ensureSpec: (threadId, spec) => {
      const cur = get().threads[threadId];
      // Don't overwrite a live stream or edits already in this session — only
      // hydrate an empty thread (e.g. first entry into edit on a saved board).
      if (cur?.isStreaming || isNonEmptySpec(cur?.spec)) return;
      patch(threadId, (prev) => ({ ...prev, spec }));
    },

    setElementProp: (threadId, elementKey, propPath, value) => {
      patch(threadId, (prev) => {
        if (!isNonEmptySpec(prev.spec)) return prev;
        const el = prev.spec.elements[elementKey];
        if (!el) return prev;
        // Catalog prop paths are single segments (e.g. "/title"). New refs all
        // the way up so Zustand selectors + dirty-detection both fire.
        const propName = propPath.replace(/^\//, "");
        const nextSpec: Spec = {
          ...prev.spec,
          elements: {
            ...prev.spec.elements,
            [elementKey]: {
              ...el,
              props: { ...el.props, [propName]: value },
            },
          },
        };
        return { ...prev, spec: nextSpec };
      });
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
