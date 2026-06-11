import { z } from "zod";

// Input for generating a channel's CONTEXT.md via a one-shot background agent.
// The agent explores the repo at `repoPath` plus PostHog data for things
// related to `channelName`, then publishes CONTEXT.md itself via the PostHog
// MCP (`desktop-file-system-instructions-partial-update`).
export const contextGenerateInput = z.object({
  /** Channel (desktop folder) id — also the instructions write target. */
  channelId: z.string().min(1),
  /** Display name the agent searches the repo + PostHog data for. */
  channelName: z.string().min(1),
  /** Absolute path to the local repo the agent explores (its cwd). */
  repoPath: z.string().min(1),
  /**
   * System prompt describing the task. Computed in the renderer (it knows the
   * channel name, project id, and current instructions version) and applied
   * once when the ephemeral agent session for this channel is created.
   */
  systemPrompt: z.string().min(1),
  model: z.string().optional(),
});
export type ContextGenerateInput = z.infer<typeof contextGenerateInput>;

export const contextThreadInput = z.object({
  channelId: z.string().min(1),
});
export type ContextThreadInput = z.infer<typeof contextThreadInput>;

// Events streamed to the renderer as the agent works. `prose` carries streamed
// markdown chunks (a live preview); `tool` reports the active tool call.
export const contextStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("started") }),
  z.object({ type: z.literal("prose"), text: z.string() }),
  z.object({
    type: z.literal("tool"),
    toolName: z.string(),
    status: z.string(),
  }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ContextStreamEvent = z.infer<typeof contextStreamEventSchema>;

export const ContextGenEvent = { Event: "context-event" } as const;

export interface ContextGenEventPayload {
  channelId: string;
  event: ContextStreamEvent;
}

export interface ContextGenEvents {
  [ContextGenEvent.Event]: ContextGenEventPayload;
}
