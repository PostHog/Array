import type { StoredLogEntry } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import {
  capStoredEntries,
  capStoredEntryPayloads,
  MAX_MEDIA_DATA_CHARS,
  MAX_TEXT_CHARS,
} from "./sessionEntryCaps";

const LONG_TEXT = "x".repeat(MAX_TEXT_CHARS + 500);
const LONG_MEDIA = "y".repeat(MAX_MEDIA_DATA_CHARS + 1);

function sessionUpdateEntry(update: Record<string, unknown>): StoredLogEntry {
  return {
    type: "notification",
    timestamp: "2026-07-23T11:00:00Z",
    notification: {
      method: "session/update",
      params: { sessionId: "s1", update },
    },
  };
}

function updateOf(entry: StoredLogEntry): Record<string, unknown> {
  const params = entry.notification?.params as { update: unknown };
  return params.update as Record<string, unknown>;
}

describe("capStoredEntryPayloads", () => {
  it.each([
    [
      "agent_message_chunk",
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: LONG_TEXT },
      },
    ],
    [
      "user_message_chunk",
      {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: LONG_TEXT },
      },
    ],
    [
      "agent_thought_chunk",
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: LONG_TEXT },
      },
    ],
  ])("truncates long %s text", (_kind, update) => {
    const capped = updateOf(capStoredEntryPayloads(sessionUpdateEntry(update)));
    const content = capped.content as { text: string };
    expect(content.text.length).toBeLessThan(LONG_TEXT.length);
    expect(content.text).toContain("[truncated 500 chars]");
  });

  it.each([
    ["rawInput string field", { rawInput: { content: LONG_TEXT } }],
    ["rawOutput string field", { rawOutput: { stdout: LONG_TEXT } }],
    ["nested rawOutput array", { rawOutput: { items: [{ text: LONG_TEXT }] } }],
    ["_meta payload", { _meta: { claudeCode: { toolResponse: LONG_TEXT } } }],
  ])("truncates strings inside %s while keeping the shape", (_name, fields) => {
    const entry = sessionUpdateEntry({
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      ...fields,
    });
    const capped = updateOf(capStoredEntryPayloads(entry));
    const json = JSON.stringify(capped);
    expect(json.length).toBeLessThan(JSON.stringify(updateOf(entry)).length);
    expect(json).toContain("[truncated 500 chars]");
    for (const key of Object.keys(fields)) {
      expect(Object.keys(capped)).toContain(key);
    }
  });

  it("truncates diff oldText and newText in tool content", () => {
    const entry = sessionUpdateEntry({
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      content: [
        { type: "diff", path: "a.ts", oldText: LONG_TEXT, newText: LONG_TEXT },
      ],
    });
    const capped = updateOf(capStoredEntryPayloads(entry));
    const [diff] = capped.content as { oldText: string; newText: string }[];
    expect(diff.oldText).toContain("[truncated 500 chars]");
    expect(diff.newText).toContain("[truncated 500 chars]");
  });

  it("truncates text blocks nested in tool content", () => {
    const entry = sessionUpdateEntry({
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      content: [
        { type: "content", content: { type: "text", text: LONG_TEXT } },
      ],
    });
    const capped = updateOf(capStoredEntryPayloads(entry));
    const [item] = capped.content as { content: { text: string } }[];
    expect(item.content.text).toContain("[truncated 500 chars]");
  });

  it.each([
    ["image", { type: "image", data: LONG_MEDIA, mimeType: "image/png" }],
    ["audio", { type: "audio", data: LONG_MEDIA, mimeType: "audio/wav" }],
  ])("replaces an oversized %s block with a placeholder", (_kind, block) => {
    const entry = sessionUpdateEntry({
      sessionUpdate: "user_message_chunk",
      content: block,
    });
    const capped = updateOf(capStoredEntryPayloads(entry));
    const content = capped.content as { type: string; text: string };
    expect(content.type).toBe("text");
    expect(content.text).toContain("omitted");
  });

  it("keeps an image block under the media cap untouched", () => {
    const block = {
      type: "image",
      data: "z".repeat(1000),
      mimeType: "image/png",
    };
    const entry = sessionUpdateEntry({
      sessionUpdate: "user_message_chunk",
      content: block,
    });
    expect(capStoredEntryPayloads(entry)).toBe(entry);
  });

  it("caps prompt content blocks on session/prompt requests", () => {
    const entry: StoredLogEntry = {
      type: "notification",
      notification: {
        id: 1,
        method: "session/prompt",
        params: {
          sessionId: "s1",
          prompt: [{ type: "text", text: LONG_TEXT }],
        },
      },
    };
    const capped = capStoredEntryPayloads(entry);
    const params = capped.notification?.params as {
      prompt: { text: string }[];
    };
    expect(params.prompt[0].text).toContain("[truncated 500 chars]");
  });

  it("replaces an oversized resource blob block with a placeholder", () => {
    const entry = sessionUpdateEntry({
      sessionUpdate: "user_message_chunk",
      content: {
        type: "resource",
        resource: { uri: "file:///a", blob: LONG_MEDIA },
      },
    });
    const capped = updateOf(capStoredEntryPayloads(entry));
    const content = capped.content as { type: string; text: string };
    expect(content.type).toBe("text");
    expect(content.text).toContain("omitted");
  });

  it.each([
    [
      "small tool_call_update",
      sessionUpdateEntry({
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        rawInput: { file_path: "a.ts" },
        content: [{ type: "content", content: { type: "text", text: "ok" } }],
      }),
    ],
    [
      "non session/update notification",
      {
        type: "notification",
        notification: {
          method: "session/request_permission",
          params: { big: LONG_TEXT },
        },
      } as StoredLogEntry,
    ],
    [
      "entry without notification",
      { type: "marker", timestamp: "2026-07-23T11:00:00Z" } as StoredLogEntry,
    ],
  ])("returns %s by reference unchanged", (_name, entry) => {
    expect(capStoredEntryPayloads(entry)).toBe(entry);
  });
});

describe("capStoredEntries", () => {
  it("returns the same array when nothing needs capping", () => {
    const entries = [
      sessionUpdateEntry({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "short" },
      }),
    ];
    expect(capStoredEntries(entries)).toBe(entries);
  });

  it("returns a new array preserving uncapped entries by reference", () => {
    const small = sessionUpdateEntry({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "short" },
    });
    const big = sessionUpdateEntry({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: LONG_TEXT },
    });
    const capped = capStoredEntries([small, big]);
    expect(capped).not.toBe([small, big]);
    expect(capped[0]).toBe(small);
    expect(capped[1]).not.toBe(big);
  });
});
