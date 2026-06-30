/**
 * Pure transformation functions for session data.
 * No side effects, no store access - just data transformations.
 */
import type {
  AvailableCommand,
  ContentBlock,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import type {
  AcpMessage,
  JsonRpcMessage,
  JsonRpcRequest,
  StoredLogEntry,
  UserShellExecuteParams,
} from "@posthog/shared";
import {
  IMPORTED_USER_PROMPT_META_KEY,
  isJsonRpcNotification,
  isJsonRpcRequest,
} from "@posthog/shared";
import { skillTagsToSlashCommands } from "../message-editor/skillTags";
import { isNotification, POSTHOG_NOTIFICATIONS } from "./acpNotifications";
import { extractPromptDisplayContent } from "./promptContent";

/**
 * Convert a stored log entry to an ACP message.
 */
function storedEntryToAcpMessage(entry: StoredLogEntry): AcpMessage {
  const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();
  const promoted = promoteImportedUserPrompt(entry, ts);
  if (promoted) return promoted;
  return {
    type: "acp_message",
    ts,
    message: (entry.notification ?? {}) as JsonRpcMessage,
  };
}

/**
 * A typed user prompt replayed from an imported Claude Code session arrives as
 * a `user_message_chunk` tagged with `_meta.importedUserPrompt`. The renderer
 * ignores raw user_message_chunks (live, user turns render from session/prompt
 * requests), so promote the tagged ones into a session/prompt user event. Only
 * affects imported sessions; normal logs carry no such marker.
 */
function promoteImportedUserPrompt(
  entry: StoredLogEntry,
  ts: number,
): AcpMessage | null {
  const notification = entry.notification as
    | { method?: string; params?: { update?: Record<string, unknown> } }
    | undefined;
  if (notification?.method !== "session/update") return null;
  const update = notification.params?.update;
  const meta = update?._meta as Record<string, unknown> | undefined;
  if (
    !update ||
    update.sessionUpdate !== "user_message_chunk" ||
    meta?.[IMPORTED_USER_PROMPT_META_KEY] !== true
  ) {
    return null;
  }
  const content = update.content as
    | { type?: string; text?: string }
    | undefined;
  if (content?.type !== "text" || !content.text) return null;
  return createUserMessageEvent(content.text, ts);
}

/**
 * Create a user message event for display.
 */
export function createUserPromptEvent(
  prompt: ContentBlock[],
  ts: number,
): AcpMessage {
  return {
    type: "acp_message",
    ts,
    message: {
      jsonrpc: "2.0",
      id: ts,
      method: "session/prompt",
      params: {
        prompt,
      },
    } as JsonRpcRequest,
  };
}

export function createUserMessageEvent(text: string, ts: number): AcpMessage {
  return createUserPromptEvent([{ type: "text", text }], ts);
}

/**
 * Create a user shell execute event.
 * When id is provided, it's used to track async execution (start/complete).
 * When result is undefined, it represents a command that's still running.
 */
export function createUserShellExecuteEvent(
  command: string,
  cwd: string,
  result?: { stdout: string; stderr: string; exitCode: number },
  id?: string,
): AcpMessage {
  return {
    type: "acp_message",
    ts: Date.now(),
    message: {
      jsonrpc: "2.0",
      method: "_array/user_shell_execute",
      params: { id, command, cwd, result },
    },
  };
}

/**
 * Collects completed user shell executes that occurred after the last prompt request.
 * These are included as hidden context in the next prompt so the agent
 * knows what commands the user ran between turns.
 *
 * Scans backwards from the end of events, stopping at the most recent
 * session/prompt request (not response), collecting any _array/user_shell_execute
 * notifications found along the way. Deduplicates by ID, keeping only completed executes.
 */
export function getUserShellExecutesSinceLastPrompt(
  events: AcpMessage[],
): UserShellExecuteParams[] {
  const execMap = new Map<string, UserShellExecuteParams>();

  for (let i = events.length - 1; i >= 0; i--) {
    const msg = events[i].message;

    if (isJsonRpcRequest(msg) && msg.method === "session/prompt") break;

    if (
      isJsonRpcNotification(msg) &&
      msg.method === "_array/user_shell_execute"
    ) {
      const params = msg.params as UserShellExecuteParams;
      if (params.result && params.id && !execMap.has(params.id)) {
        execMap.set(params.id, params);
      }
    }
  }

  return Array.from(execMap.values()).reverse();
}

/**
 * Convert shell executes to content blocks for prompt context.
 */
export function shellExecutesToContextBlocks(
  shellExecutes: UserShellExecuteParams[],
): ContentBlock[] {
  return shellExecutes
    .filter((cmd) => cmd.result)
    .map((cmd) => ({
      type: "text" as const,
      text: `[User executed command in ${cmd.cwd}]\n$ ${cmd.command}\n${
        cmd.result?.stdout || cmd.result?.stderr || "(no output)"
      }`,
      _meta: { ui: { hidden: true } },
    }));
}

/**
 * Convert stored log entries to ACP messages.
 * Optionally prepends a user message with the task description.
 */
export function convertStoredEntriesToEvents(
  entries: StoredLogEntry[],
  taskDescription?: string,
): AcpMessage[] {
  const events: AcpMessage[] = [];

  if (taskDescription) {
    const startTs = entries[0]?.timestamp
      ? new Date(entries[0].timestamp).getTime() - 1
      : Date.now();
    events.push(createUserMessageEvent(taskDescription, startTs));
  }

  for (const entry of entries) {
    events.push(storedEntryToAcpMessage(entry));
  }

  return events;
}

/**
 * Extract available commands from session events.
 * Scans backwards to find the most recent available_commands_update.
 * Returns `null` if the agent has not emitted one yet — callers can use this
 * to distinguish "not yet received" from "received an empty list".
 */
export function extractAvailableCommandsFromEvents(
  events: AcpMessage[],
): AvailableCommand[] | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const msg = events[i].message;
    if (
      "method" in msg &&
      msg.method === "session/update" &&
      !("id" in msg) &&
      "params" in msg
    ) {
      const params = msg.params as SessionNotification | undefined;
      const update = params?.update;
      if (update?.sessionUpdate === "available_commands_update") {
        return update.availableCommands || [];
      }
    }
  }
  return null;
}

/**
 * Extract user prompts from session events.
 * Returns an array of user prompt strings, most recent last.
 */
export function extractUserPromptsFromEvents(events: AcpMessage[]): string[] {
  const prompts: string[] = [];

  for (const event of events) {
    const msg = event.message;
    if (isJsonRpcRequest(msg) && msg.method === "session/prompt") {
      const params = msg.params as { prompt?: ContentBlock[] };
      if (params?.prompt?.length) {
        const { text, attachments } = extractPromptDisplayContent(
          params.prompt,
          { filterHidden: true },
        );

        if (text) {
          prompts.push(text);
        } else if (attachments.length > 0) {
          const labels = attachments.map((a) => a.label).join(", ");
          prompts.push(`[Attached files: ${labels}]`);
        }
      }
    }
  }

  return prompts;
}

export function extractPromptText(prompt: string | ContentBlock[]): string {
  if (typeof prompt === "string") return skillTagsToSlashCommands(prompt);
  return skillTagsToSlashCommands(extractPromptDisplayContent(prompt).text);
}

/**
 * Convert prompt input to ContentBlocks.
 */
export function normalizePromptToBlocks(
  prompt: string | ContentBlock[],
): ContentBlock[] {
  if (typeof prompt === "string") {
    return [{ type: "text", text: skillTagsToSlashCommands(prompt) }];
  }

  return prompt.map((block) =>
    block.type === "text"
      ? { ...block, text: skillTagsToSlashCommands(block.text) }
      : block,
  );
}

export { isFatalSessionError, isRateLimitError } from "@posthog/shared";

/**
 * Whether a list of events already contains a `session/prompt` request.
 */
export function hasSessionPromptEvent(events: AcpMessage[]): boolean {
  return events.some(
    (event) =>
      isJsonRpcRequest(event.message) &&
      event.message.method === "session/prompt",
  );
}

/**
 * Whether an event is a turn-complete notification.
 */
export function isTurnCompleteEvent(event: AcpMessage): boolean {
  const msg = event.message;
  return (
    "method" in msg &&
    isNotification(msg.method, POSTHOG_NOTIFICATIONS.TURN_COMPLETE)
  );
}

const FOLDER_TAG_REGEX = /<folder\s+path="([^"]+)"\s*\/>/g;

/**
 * Whether a path string looks like an absolute (or home-relative) folder path.
 */
export function isAbsoluteFolderPath(path: string): boolean {
  return (
    path.startsWith("/") || path.startsWith("~") || /^[A-Za-z]:[\\/]/.test(path)
  );
}

/**
 * Whether a prompt references an absolute folder via a `<folder path="…" />` tag.
 */
export function promptReferencesAbsoluteFolder(
  prompt: string | ContentBlock[],
): boolean {
  const text =
    typeof prompt === "string"
      ? prompt
      : prompt
          .map((block) =>
            "text" in block && typeof block.text === "string" ? block.text : "",
          )
          .join("");
  for (const match of text.matchAll(FOLDER_TAG_REGEX)) {
    if (isAbsoluteFolderPath(match[1])) return true;
  }
  return false;
}
