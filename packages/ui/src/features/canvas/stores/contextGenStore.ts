import { logger } from "@posthog/ui/shell/logger";
import { create } from "zustand";
import { hostClient } from "../hostClient";

const log = logger.scope("context-gen-store");

export type ContextGenStatus = "idle" | "running" | "done" | "error";

export interface ContextGenChannelState {
  status: ContextGenStatus;
  /** Markdown streamed by the agent so far (live preview). */
  proseBuffer: string;
  /** Title of the currently running tool call, or null when idle. */
  activeTool: string | null;
  error: string | null;
}

// Stable empty reference so selectors for an untouched channel don't churn.
export const EMPTY_CONTEXT_STATE: ContextGenChannelState = {
  status: "idle",
  proseBuffer: "",
  activeTool: null,
  error: null,
};

export interface ContextGenStartInput {
  channelId: string;
  channelName: string;
  repoPath: string;
  systemPrompt: string;
  model?: string;
}

interface ContextGenStore {
  // Per-channel generation state, keyed by channel id.
  channels: Record<string, ContextGenChannelState>;

  start: (input: ContextGenStartInput) => Promise<void>;
  /** Clear a channel's state locally and cancel any running agent session. */
  reset: (channelId: string) => void;

  // Stream handlers, driven by the subscription registrar.
  appendProse: (channelId: string, text: string) => void;
  noteTool: (channelId: string, toolName: string, status: string) => void;
  finish: (channelId: string) => void;
  fail: (channelId: string, message: string) => void;
}

export const useContextGenStore = create<ContextGenStore>()((set, get) => {
  const patch = (
    channelId: string,
    fn: (prev: ContextGenChannelState) => ContextGenChannelState,
  ) =>
    set((s) => ({
      channels: {
        ...s.channels,
        [channelId]: fn(s.channels[channelId] ?? EMPTY_CONTEXT_STATE),
      },
    }));

  return {
    channels: {},

    start: async (input) => {
      const { channelId, channelName, repoPath, systemPrompt, model } = input;
      const current = get().channels[channelId] ?? EMPTY_CONTEXT_STATE;
      if (current.status === "running") return;

      patch(channelId, () => ({
        status: "running",
        proseBuffer: "",
        activeTool: null,
        error: null,
      }));

      try {
        await hostClient().contextGen.generate.mutate({
          channelId,
          channelName,
          repoPath,
          systemPrompt,
          ...(model ? { model } : {}),
        });
      } catch (error) {
        log.error("Context generate failed", { error });
        get().fail(
          channelId,
          error instanceof Error ? error.message : String(error),
        );
      }
    },

    reset: (channelId) => {
      patch(channelId, () => ({ ...EMPTY_CONTEXT_STATE }));
      void hostClient()
        .contextGen.reset.mutate({ channelId })
        .catch(() => {});
    },

    appendProse: (channelId, text) => {
      patch(channelId, (prev) => ({
        ...prev,
        proseBuffer: prev.proseBuffer + text,
      }));
    },

    noteTool: (channelId, toolName, status) => {
      patch(channelId, (prev) => ({
        ...prev,
        activeTool: status === "completed" ? null : toolName,
      }));
    },

    finish: (channelId) => {
      patch(channelId, (prev) => ({
        ...prev,
        status: "done",
        activeTool: null,
      }));
    },

    fail: (channelId, message) => {
      patch(channelId, (prev) => ({
        ...prev,
        status: "error",
        activeTool: null,
        error: message,
      }));
    },
  };
});

/** Subscribe to a single channel's generation state (stable empty ref absent). */
export function useContextGenChannel(
  channelId: string,
): ContextGenChannelState {
  return useContextGenStore(
    (s) => s.channels[channelId] ?? EMPTY_CONTEXT_STATE,
  );
}
