import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  AgentSessionEvent,
  RpcClient,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { PiRuntime } from "./runtime";

function assistant(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages" as AssistantMessage["api"],
    provider: "anthropic" as AssistantMessage["provider"],
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  };
}

function createClient() {
  let listener: (event: AgentSessionEvent) => void = () => {};
  const send = vi.fn();
  const client = {
    onEvent: vi.fn((nextListener) => {
      listener = nextListener;
      return () => {};
    }),
    send,
  } as unknown as RpcClient;

  return {
    client,
    emit: (event: AgentSessionEvent) => listener(event),
    send,
  };
}

describe("PiRuntime", () => {
  it("streams and completes direct bash from one RPC operation", async () => {
    const { client, emit, send } = createClient();
    const runtime = new PiRuntime(client);
    const conversationListener = vi.fn();
    runtime.onConversationEvent(conversationListener);
    send.mockImplementation(async () => {
      emit({ type: "bash_execution_update", id: "req_1", delta: "one\n" });
      emit({ type: "bash_execution_update", id: "req_1", delta: "two\n" });
      return {
        type: "response",
        command: "bash",
        success: true,
        data: {
          output: "one\ntwo\n",
          exitCode: 0,
          cancelled: false,
          truncated: false,
        },
      };
    });

    await runtime.sendCommand({ type: "bash", command: "print-lines" });

    const events = conversationListener.mock.calls.map(([event]) => event);
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({
      type: "tool_call_started",
      toolCall: { title: "print-lines", status: "in_progress" },
    });
    const toolCallId = events[0].toolCall.id;
    expect(events[2]).toMatchObject({
      type: "tool_call_updated",
      toolCall: {
        id: toolCallId,
        content: [
          {
            type: "content",
            content: { type: "text", text: "one\ntwo\n" },
          },
        ],
      },
    });
    expect(events[3]).toMatchObject({
      type: "tool_call_updated",
      toolCall: { id: toolCallId, status: "completed" },
    });
  });

  it("normalizes live Pi events before forwarding them", () => {
    const { client, emit } = createClient();
    const runtime = new PiRuntime(client);
    const conversationListener = vi.fn();
    runtime.onConversationEvent(conversationListener);

    emit({ type: "message_end", message: assistant("hello") });

    expect(conversationListener).toHaveBeenCalledWith({
      type: "assistant_message_chunk",
      timestamp: 1,
      content: { type: "text", text: "hello" },
    });
  });
});
