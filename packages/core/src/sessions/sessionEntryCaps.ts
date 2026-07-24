import type { StoredLogEntry } from "@posthog/shared";

export const MAX_TEXT_CHARS = 100_000;
export const MAX_MEDIA_DATA_CHARS = 10_000_000;
const MAX_RAW_PAYLOAD_DEPTH = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncateText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_TEXT_CHARS)}… [truncated ${text.length - MAX_TEXT_CHARS} chars]`;
}

function mapShared<T>(items: T[], mapFn: (item: T) => T): T[] {
  let result: T[] | undefined;
  for (let index = 0; index < items.length; index += 1) {
    const mapped = mapFn(items[index]);
    if (!result && mapped !== items[index]) {
      result = items.slice(0, index);
    }
    result?.push(mapped);
  }
  return result ?? items;
}

// Truncates long strings anywhere inside a raw tool payload while keeping the
// object shape intact, so tool views that read structured fields
// (rawInput.content, rawOutput.stdout, ...) still render a preview instead of
// losing the field to a wholesale replacement.
function capDeepStrings(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return truncateText(value);
  if (depth >= MAX_RAW_PAYLOAD_DEPTH || value === null) return value;
  if (Array.isArray(value)) {
    return mapShared(value, (item) => capDeepStrings(item, depth + 1));
  }
  if (!isRecord(value)) return value;
  let next: Record<string, unknown> | undefined;
  for (const [key, entryValue] of Object.entries(value)) {
    const capped = capDeepStrings(entryValue, depth + 1);
    if (capped !== entryValue) {
      next ??= { ...value };
      next[key] = capped;
    }
  }
  return next ?? value;
}

// A truncated base64 payload renders as a broken image, so oversized media
// blocks are replaced with a text placeholder instead of being sliced.
function capContentBlock(block: unknown): unknown {
  if (!isRecord(block)) return block;
  if (block.type === "text" && typeof block.text === "string") {
    const text = truncateText(block.text);
    return text === block.text ? block : { ...block, text };
  }
  if (
    (block.type === "image" || block.type === "audio") &&
    typeof block.data === "string" &&
    block.data.length > MAX_MEDIA_DATA_CHARS
  ) {
    return {
      type: "text",
      text: `[${block.type} omitted: ${Math.round(block.data.length / 1_000_000)}M chars exceeds transcript limit]`,
    };
  }
  if (block.type === "resource" && isRecord(block.resource)) {
    const resource = block.resource;
    if (
      typeof resource.blob === "string" &&
      resource.blob.length > MAX_MEDIA_DATA_CHARS
    ) {
      return {
        type: "text",
        text: `[resource omitted: ${Math.round(resource.blob.length / 1_000_000)}M chars exceeds transcript limit]`,
      };
    }
    if (typeof resource.text === "string") {
      const text = truncateText(resource.text);
      if (text !== resource.text) {
        return { ...block, resource: { ...resource, text } };
      }
    }
    return block;
  }
  return block;
}

function capToolCallContent(item: unknown): unknown {
  if (!isRecord(item)) return item;
  if (item.type === "content") {
    const content = capContentBlock(item.content);
    return content === item.content ? item : { ...item, content };
  }
  if (item.type === "diff") {
    const oldText =
      typeof item.oldText === "string" ? truncateText(item.oldText) : undefined;
    const newText =
      typeof item.newText === "string" ? truncateText(item.newText) : undefined;
    const oldChanged = oldText !== undefined && oldText !== item.oldText;
    const newChanged = newText !== undefined && newText !== item.newText;
    if (!oldChanged && !newChanged) return item;
    const next: Record<string, unknown> = { ...item };
    if (oldChanged) next.oldText = oldText;
    if (newChanged) next.newText = newText;
    return next;
  }
  return item;
}

function capSessionUpdate(update: unknown): unknown {
  if (!isRecord(update)) return update;
  const kind = update.sessionUpdate;
  if (kind === "tool_call" || kind === "tool_call_update") {
    const rawInput = capDeepStrings(update.rawInput);
    const rawOutput = capDeepStrings(update.rawOutput);
    const meta = capDeepStrings(update._meta);
    const content = Array.isArray(update.content)
      ? mapShared(update.content, capToolCallContent)
      : update.content;
    const changed =
      rawInput !== update.rawInput ||
      rawOutput !== update.rawOutput ||
      meta !== update._meta ||
      content !== update.content;
    if (!changed) return update;
    const next: Record<string, unknown> = { ...update };
    if (rawInput !== update.rawInput) next.rawInput = rawInput;
    if (rawOutput !== update.rawOutput) next.rawOutput = rawOutput;
    if (meta !== update._meta) next._meta = meta;
    if (content !== update.content) next.content = content;
    return next;
  }
  if (
    kind === "agent_message_chunk" ||
    kind === "user_message_chunk" ||
    kind === "agent_thought_chunk"
  ) {
    const content = capContentBlock(update.content);
    return content === update.content ? update : { ...update, content };
  }
  return update;
}

/**
 * Bound the memory a single stored transcript entry can pin in the renderer.
 * Applied at every entry acquisition point (local/S3 log parse, cloud
 * hydration, cloud watcher pages) so entry comparisons downstream (resume
 * overlap detection, hydration hashes) always see identically capped shapes.
 */
export function capStoredEntryPayloads(entry: StoredLogEntry): StoredLogEntry {
  const notification = entry.notification;
  if (!notification) return entry;
  if (notification.method === "session/update") {
    const params = notification.params;
    if (!isRecord(params)) return entry;
    const update = capSessionUpdate(params.update);
    if (update === params.update) return entry;
    return {
      ...entry,
      notification: { ...notification, params: { ...params, update } },
    };
  }
  if (notification.method === "session/prompt") {
    const params = notification.params;
    if (!isRecord(params) || !Array.isArray(params.prompt)) return entry;
    const prompt = mapShared(params.prompt, capContentBlock);
    if (prompt === params.prompt) return entry;
    return {
      ...entry,
      notification: { ...notification, params: { ...params, prompt } },
    };
  }
  return entry;
}

export function capStoredEntries(entries: StoredLogEntry[]): StoredLogEntry[] {
  return mapShared(entries, capStoredEntryPayloads);
}
