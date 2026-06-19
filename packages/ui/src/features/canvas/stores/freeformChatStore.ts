import type { FreeformVersion } from "@posthog/core/canvas/freeformSchemas";
import { logger } from "@posthog/ui/shell/logger";
import { create } from "zustand";
import { hostClient } from "../hostClient";

const log = logger.scope("freeform-chat-store");

export interface FreeformMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface FreeformThreadState {
  messages: FreeformMessage[];
  /** The currently-rendered source. */
  code: string;
  /** Ordered edit history (oldest first). */
  versions: FreeformVersion[];
  /** Which version is live (undo/redo moves this). */
  currentVersionId: string | null;
  isStreaming: boolean;
  /** True while an autosave is in flight (drives the toolbar's saving spinner). */
  isSaving: boolean;
  lastTool: string | null;
  /** Agent/stream error (chat-level). */
  error: string | null;
  /** Latest runtime/compile error reported by the sandbox (self-repair signal). */
  runtimeError: string | null;
  // The user prompt of the in-flight turn, stamped onto the version it produces.
  pendingPrompt: string | null;
}

export const EMPTY_FREEFORM_THREAD: FreeformThreadState = {
  messages: [],
  code: "",
  versions: [],
  currentVersionId: null,
  isStreaming: false,
  isSaving: false,
  lastTool: null,
  error: null,
  runtimeError: null,
  pendingPrompt: null,
};

interface FreeformChatStore {
  threads: Record<string, FreeformThreadState>;

  send: (threadId: string, prompt: string) => Promise<void>;
  reset: (threadId: string) => Promise<void>;
  /** Seed a thread from a saved record (only if the thread is still empty). */
  ensureCode: (threadId: string, record: SavedFreeform) => void;
  undo: (threadId: string) => void;
  redo: (threadId: string) => void;
  setRuntimeError: (threadId: string, message: string | null) => void;
  /**
   * Revert: when viewing a non-latest version, make it the head (drop the newer
   * versions) and autosave. The canvas then continues from this version.
   */
  revert: (threadId: string) => void;
  /** Cancel a version browse: jump back to the latest version (no save). */
  goToLatest: (threadId: string) => void;

  // Stream handlers (driven by the subscription registrar).
  appendProse: (threadId: string, text: string) => void;
  setCode: (threadId: string, code: string) => void;
  noteTool: (threadId: string, toolName: string, status: string) => void;
  finish: (threadId: string) => void;
  fail: (threadId: string, message: string) => void;
}

// The saved-record shape used to seed / revert a thread.
interface SavedFreeform {
  code?: string;
  versions?: FreeformVersion[];
  currentVersionId?: string;
}

function newId(): string {
  return crypto.randomUUID();
}

// The dashboardId a thread persists to ("dashboard:<id>" → "<id>").
function dashboardIdOf(threadId: string): string {
  return threadId.replace(/^dashboard:/, "");
}

export const useFreeformChatStore = create<FreeformChatStore>()((set, get) => {
  const patch = (
    threadId: string,
    fn: (prev: FreeformThreadState) => FreeformThreadState,
  ) =>
    set((s) => ({
      threads: {
        ...s.threads,
        [threadId]: fn(s.threads[threadId] ?? EMPTY_FREEFORM_THREAD),
      },
    }));

  // Autosave the current code + history to the backend, toggling isSaving so the
  // toolbar can show a spinner. Never throws.
  const persist = async (threadId: string) => {
    const t = get().threads[threadId];
    if (!t) return;
    patch(threadId, (prev) => ({ ...prev, isSaving: true }));
    try {
      await hostClient().dashboards.saveFreeform.mutate({
        id: dashboardIdOf(threadId),
        code: t.code,
        versions: t.versions,
        currentVersionId: t.currentVersionId ?? undefined,
      });
    } catch (error) {
      log.error("Freeform autosave failed", { error });
    } finally {
      patch(threadId, (prev) => ({ ...prev, isSaving: false }));
    }
  };

  return {
    threads: {},

    send: async (threadId, prompt) => {
      const text = prompt.trim();
      const current = get().threads[threadId] ?? EMPTY_FREEFORM_THREAD;
      if (!text || current.isStreaming) return;

      const userMessage: FreeformMessage = {
        id: newId(),
        role: "user",
        text,
      };
      const assistantMessage: FreeformMessage = {
        id: newId(),
        role: "assistant",
        text: "",
      };
      patch(threadId, (prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage, assistantMessage],
        isStreaming: true,
        error: null,
        lastTool: null,
        pendingPrompt: text,
      }));

      // Anchor the agent to the current file + clock. The system prompt is frozen
      // at session start, so the live code rides each turn (Q7: full-file rewrite
      // means the agent must see the whole current file to rewrite it).
      const now = new Date();
      const parts = [
        `[Now] ${now.toISOString()} (epoch ms ${now.getTime()}).`,
        current.code
          ? [
              "[Context] You are editing the existing app below. Rewrite the WHOLE file with the requested change; keep everything else intact.",
              "```tsx",
              current.code,
              "```",
            ].join("\n")
          : "[Context] You are starting a new, empty app.",
        "",
        text,
      ];
      try {
        await hostClient().freeformGen.generate.mutate({
          threadId,
          prompt: parts.filter(Boolean).join("\n"),
          currentCode: current.code || null,
        });
      } catch (error) {
        log.error("Freeform generate failed", { error });
        get().fail(
          threadId,
          error instanceof Error ? error.message : String(error),
        );
      }
    },

    reset: async (threadId) => {
      patch(threadId, () => ({ ...EMPTY_FREEFORM_THREAD }));
      await hostClient()
        .freeformGen.reset.mutate({ threadId })
        .catch(() => {});
    },

    ensureCode: (threadId, record) => {
      const cur = get().threads[threadId];
      if (cur?.isStreaming || cur?.code) return;
      patch(threadId, (prev) => ({
        ...prev,
        code: record.code ?? "",
        versions: record.versions ?? [],
        currentVersionId:
          record.currentVersionId ?? record.versions?.at(-1)?.id ?? null,
      }));
    },

    undo: (threadId) => {
      patch(threadId, (prev) => {
        const idx = prev.versions.findIndex(
          (v) => v.id === prev.currentVersionId,
        );
        if (idx <= 0) return prev;
        const target = prev.versions[idx - 1];
        return { ...prev, code: target.code, currentVersionId: target.id };
      });
    },

    redo: (threadId) => {
      patch(threadId, (prev) => {
        const idx = prev.versions.findIndex(
          (v) => v.id === prev.currentVersionId,
        );
        if (idx === -1 || idx >= prev.versions.length - 1) return prev;
        const target = prev.versions[idx + 1];
        return { ...prev, code: target.code, currentVersionId: target.id };
      });
    },

    setRuntimeError: (threadId, message) => {
      patch(threadId, (prev) => ({ ...prev, runtimeError: message }));
    },

    revert: (threadId) => {
      // Adopt the version being viewed: drop everything after it so it becomes
      // the head, then autosave.
      patch(threadId, (prev) => {
        const idx = prev.versions.findIndex(
          (v) => v.id === prev.currentVersionId,
        );
        if (idx === -1) return prev;
        return { ...prev, versions: prev.versions.slice(0, idx + 1) };
      });
      void persist(threadId);
    },

    goToLatest: (threadId) => {
      // Cancel a browse: jump to the head version (already saved, no persist).
      patch(threadId, (prev) => {
        const head = prev.versions.at(-1);
        if (!head) return prev;
        return { ...prev, code: head.code, currentVersionId: head.id };
      });
    },

    appendProse: (threadId, text) => {
      patch(threadId, (prev) => ({
        ...prev,
        messages: appendToLastAssistant(prev.messages, text),
      }));
    },

    setCode: (threadId, code) => {
      // Live stream snapshot: update what's rendered, clear stale runtime error.
      patch(threadId, (prev) => ({ ...prev, code, runtimeError: null }));
    },

    noteTool: (threadId, toolName, status) => {
      patch(threadId, (prev) => ({
        ...prev,
        lastTool: status === "completed" ? null : toolName,
      }));
    },

    finish: (threadId) => {
      let committed = false;
      patch(threadId, (prev) => {
        // Commit a new version from the streamed code (Q8: linear-discard — drop
        // any redo tail beyond the current pointer before appending).
        const currentCode = prev.code;
        const headId = prev.currentVersionId;
        const headIdx = prev.versions.findIndex((v) => v.id === headId);
        const base =
          headIdx === -1 ? prev.versions : prev.versions.slice(0, headIdx + 1);
        const unchanged = base.at(-1)?.code === currentCode;
        if (unchanged || !currentCode) {
          // Clear pendingPrompt too, so a no-op turn's prompt can't get stamped
          // onto the next version that actually changes the code.
          return {
            ...prev,
            isStreaming: false,
            lastTool: null,
            pendingPrompt: null,
          };
        }
        const version: FreeformVersion = {
          id: newId(),
          code: currentCode,
          prompt: prev.pendingPrompt ?? undefined,
          createdAt: Date.now(),
        };
        committed = true;
        return {
          ...prev,
          isStreaming: false,
          lastTool: null,
          pendingPrompt: null,
          versions: [...base, version],
          currentVersionId: version.id,
        };
      });
      // Autosave the new version.
      if (committed) void persist(threadId);
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

export function useFreeformThread(threadId: string): FreeformThreadState {
  return useFreeformChatStore(
    (s) => s.threads[threadId] ?? EMPTY_FREEFORM_THREAD,
  );
}

function appendToLastAssistant(
  messages: FreeformMessage[],
  text: string,
): FreeformMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return messages;
  // Prose arrives as suffix DELTAs of the (trimmed) accumulated prose string, so
  // each delta already carries its own leading whitespace — concatenate directly
  // rather than inserting a newline (which would split sentences mid-stream).
  const joined = `${last.text}${text}`;
  return messages.map((m, i) =>
    i === messages.length - 1 ? { ...m, text: joined } : m,
  );
}
