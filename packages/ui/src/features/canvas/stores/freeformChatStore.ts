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
  lastTool: string | null;
  /** Agent/stream error (chat-level). */
  error: string | null;
  /** Latest runtime/compile error reported by the sandbox (self-repair signal). */
  runtimeError: string | null;
  // The user prompt of the in-flight turn, stamped onto the version it produces.
  pendingPrompt: string | null;
  // The version the current edit session started at. Cancel reverts here (and
  // discards versions after it). null = started from empty.
  editBaselineVersionId: string | null;
}

export const EMPTY_FREEFORM_THREAD: FreeformThreadState = {
  messages: [],
  code: "",
  versions: [],
  currentVersionId: null,
  isStreaming: false,
  lastTool: null,
  error: null,
  runtimeError: null,
  pendingPrompt: null,
  editBaselineVersionId: null,
};

interface FreeformChatStore {
  threads: Record<string, FreeformThreadState>;

  send: (threadId: string, prompt: string) => Promise<void>;
  reset: (threadId: string) => Promise<void>;
  /** Seed a thread from a saved record (only if the thread is still empty). */
  ensureCode: (
    threadId: string,
    record: {
      code?: string;
      versions?: FreeformVersion[];
      currentVersionId?: string;
    },
  ) => void;
  undo: (threadId: string) => void;
  redo: (threadId: string) => void;
  setRuntimeError: (threadId: string, message: string | null) => void;
  /** Record the current version as the edit session's baseline (on entering edit). */
  beginEdit: (threadId: string) => void;
  /** Cancel: revert code + history to the edit baseline and persist. */
  revertToBaseline: (threadId: string) => void;

  // Stream handlers (driven by the subscription registrar).
  appendProse: (threadId: string, text: string) => void;
  setCode: (threadId: string, code: string) => void;
  noteTool: (threadId: string, toolName: string, status: string) => void;
  finish: (threadId: string) => void;
  fail: (threadId: string, message: string) => void;
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

  // Persist the current code + history to the backend (autosave). Never throws.
  const persist = async (threadId: string) => {
    const t = get().threads[threadId];
    if (!t) return;
    try {
      await hostClient().dashboards.saveFreeform.mutate({
        id: dashboardIdOf(threadId),
        code: t.code,
        versions: t.versions,
        currentVersionId: t.currentVersionId ?? undefined,
      });
    } catch (error) {
      log.error("Freeform autosave failed", { error });
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
      void persist(threadId);
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
      void persist(threadId);
    },

    setRuntimeError: (threadId, message) => {
      patch(threadId, (prev) => ({ ...prev, runtimeError: message }));
    },

    beginEdit: (threadId) => {
      patch(threadId, (prev) => ({
        ...prev,
        editBaselineVersionId: prev.currentVersionId,
      }));
    },

    revertToBaseline: (threadId) => {
      patch(threadId, (prev) => {
        const baseId = prev.editBaselineVersionId;
        const baseIdx = baseId
          ? prev.versions.findIndex((v) => v.id === baseId)
          : -1;
        // baseId set but missing (truncated away) → fall through to empty.
        if (baseId && baseIdx === -1) {
          return {
            ...prev,
            code: "",
            versions: [],
            currentVersionId: null,
            editBaselineVersionId: null,
          };
        }
        if (baseIdx === -1) {
          // Started from empty: drop everything made this session.
          return {
            ...prev,
            code: "",
            versions: [],
            currentVersionId: null,
            editBaselineVersionId: null,
          };
        }
        const target = prev.versions[baseIdx];
        return {
          ...prev,
          code: target.code,
          // Linear-discard: drop the versions made after the baseline.
          versions: prev.versions.slice(0, baseIdx + 1),
          currentVersionId: target.id,
          editBaselineVersionId: null,
        };
      });
      void persist(threadId);
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
        return {
          ...prev,
          isStreaming: false,
          lastTool: null,
          pendingPrompt: null,
          versions: [...base, version],
          currentVersionId: version.id,
        };
      });
      void persist(threadId);
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
  const joined = last.text ? `${last.text}\n${text}` : text;
  return messages.map((m, i) =>
    i === messages.length - 1 ? { ...m, text: joined } : m,
  );
}
