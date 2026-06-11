import type {
  AgentSideConnection,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import type {
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { Logger } from "../../../utils/logger";
import type { Session } from "../types";
import {
  handleStreamEvent,
  handleUserAssistantMessage,
  type MessageHandlerContext,
  stripMarkerTags,
} from "./sdk-to-acp";

describe("stripMarkerTags", () => {
  it("strips a single marker and keeps surrounding prose", () => {
    expect(
      stripMarkerTags("before<command-name>/model</command-name>after"),
    ).toBe("beforeafter");
  });

  it("strips multiple different markers in one pass", () => {
    const input =
      "a<command-args>x</command-args>b<local-command-stdout>out</local-command-stdout>c";
    expect(stripMarkerTags(input)).toBe("abc");
  });

  it("leaves text without markers unchanged", () => {
    expect(stripMarkerTags("")).toBe("");
    expect(stripMarkerTags("plain prose with < and > but no tags")).toBe(
      "plain prose with < and > but no tags",
    );
  });

  it("passes an unclosed opener through verbatim (dead-set path)", () => {
    const input = "<command-name>no closing tag, prose continues";
    expect(stripMarkerTags(input)).toBe(input);
  });

  it("does not treat an orphan closing tag as an opener", () => {
    expect(
      stripMarkerTags("</command-name>text<command-name>real</command-name>"),
    ).toBe("</command-name>text");
  });

  it("matches the nearest closing tag for a repeated opener", () => {
    expect(
      stripMarkerTags(
        "<command-name>outer<command-name>inner</command-name>trailing",
      ),
    ).toBe("trailing");
  });

  it("stays linear on pathological unclosed input", () => {
    const input = `${"<command-name>".repeat(20000)}tail`;
    expect(stripMarkerTags(input)).toBe(input);
  });
});

function createHandlerContext() {
  const updates: SessionNotification[] = [];
  const client = {
    sessionUpdate: async (notification: SessionNotification) => {
      updates.push(notification);
    },
  } as unknown as AgentSideConnection;
  const context: MessageHandlerContext = {
    session: {
      cwd: "/test",
      taskState: new Map(),
      notificationHistory: [],
    } as unknown as Session,
    sessionId: "test-session",
    client,
    toolUseCache: {},
    toolUseStreamCache: new Map(),
    fileContentCache: {},
    logger: new Logger({ debug: false }),
    streamedAssistantBlocks: {
      textIds: new Set(),
      thinkingIds: new Set(),
    },
  };
  return { context, updates };
}

function streamEvent(
  event: Record<string, unknown>,
  parentToolUseId: string | null = null,
): SDKPartialAssistantMessage {
  return {
    type: "stream_event",
    parent_tool_use_id: parentToolUseId,
    uuid: "00000000-0000-0000-0000-000000000001",
    session_id: "test-session",
    event,
  } as unknown as SDKPartialAssistantMessage;
}

function assistantMessage(
  apiId: string,
  content: Array<Record<string, unknown>>,
  parentToolUseId: string | null = null,
): SDKAssistantMessage {
  return {
    type: "assistant",
    parent_tool_use_id: parentToolUseId,
    uuid: "00000000-0000-0000-0000-000000000002",
    session_id: "test-session",
    message: {
      id: apiId,
      role: "assistant",
      content,
    },
  } as unknown as SDKAssistantMessage;
}

function chunkTexts(
  updates: SessionNotification[],
  type: "agent_message_chunk" | "agent_thought_chunk",
): string[] {
  return updates
    .filter((u) => u.update.sessionUpdate === type)
    .map((u) => (u.update as { content: { text: string } }).content.text);
}

async function streamLiveText(
  context: MessageHandlerContext,
  apiId: string,
  text: string,
): Promise<void> {
  await handleStreamEvent(
    streamEvent({ type: "message_start", message: { id: apiId } }),
    context,
  );
  await handleStreamEvent(
    streamEvent({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    }),
    context,
  );
}

describe("assembled assistant text fallback", () => {
  it("forwards assembled text that never streamed", async () => {
    const { context, updates } = createHandlerContext();
    await handleUserAssistantMessage(
      assistantMessage("msg_1", [{ type: "text", text: "full answer" }]),
      context,
    );
    expect(chunkTexts(updates, "agent_message_chunk")).toEqual(["full answer"]);
  });

  it("drops assembled text that already streamed live", async () => {
    const { context, updates } = createHandlerContext();
    await streamLiveText(context, "msg_1", "streamed");
    updates.length = 0;
    await handleUserAssistantMessage(
      assistantMessage("msg_1", [{ type: "text", text: "streamed" }]),
      context,
    );
    expect(chunkTexts(updates, "agent_message_chunk")).toEqual([]);
  });

  it("forwards un-streamed thinking when only text streamed", async () => {
    const { context, updates } = createHandlerContext();
    await streamLiveText(context, "msg_1", "streamed");
    updates.length = 0;
    await handleUserAssistantMessage(
      assistantMessage("msg_1", [
        { type: "thinking", thinking: "private reasoning" },
        { type: "text", text: "streamed" },
      ]),
      context,
    );
    expect(chunkTexts(updates, "agent_message_chunk")).toEqual([]);
    expect(chunkTexts(updates, "agent_thought_chunk")).toEqual([
      "private reasoning",
    ]);
  });

  it("tracks streamed ids per message so a later message still falls back", async () => {
    const { context, updates } = createHandlerContext();
    await streamLiveText(context, "msg_1", "streamed");
    updates.length = 0;
    await handleUserAssistantMessage(
      assistantMessage("msg_2", [{ type: "text", text: "not streamed" }]),
      context,
    );
    expect(chunkTexts(updates, "agent_message_chunk")).toEqual([
      "not streamed",
    ]);
  });

  it("drops empty assembled blocks", async () => {
    const { context, updates } = createHandlerContext();
    await handleUserAssistantMessage(
      assistantMessage("msg_1", [
        { type: "thinking", thinking: "" },
        { type: "text", text: "" },
      ]),
      context,
    );
    expect(updates).toEqual([]);
  });

  it("always drops subagent assistant text", async () => {
    const { context, updates } = createHandlerContext();
    await handleUserAssistantMessage(
      assistantMessage(
        "msg_1",
        [{ type: "text", text: "subagent prose" }],
        "tool_1",
      ),
      context,
    );
    expect(chunkTexts(updates, "agent_message_chunk")).toEqual([]);
  });

  it("does not record deltas from subagent streams", async () => {
    const { context, updates } = createHandlerContext();
    await handleStreamEvent(
      streamEvent({ type: "message_start", message: { id: "msg_1" } }),
      context,
    );
    await handleStreamEvent(
      streamEvent(
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "subagent" },
        },
        "tool_1",
      ),
      context,
    );
    updates.length = 0;
    await handleUserAssistantMessage(
      assistantMessage("msg_1", [{ type: "text", text: "top-level answer" }]),
      context,
    );
    expect(chunkTexts(updates, "agent_message_chunk")).toEqual([
      "top-level answer",
    ]);
  });

  it("keeps the legacy drop-all filter without a tracker (replay)", async () => {
    const { context, updates } = createHandlerContext();
    context.streamedAssistantBlocks = undefined;
    await handleUserAssistantMessage(
      assistantMessage("msg_1", [{ type: "text", text: "replayed" }]),
      context,
    );
    expect(chunkTexts(updates, "agent_message_chunk")).toEqual([]);
  });
});
