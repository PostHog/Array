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
  const client = {
    onEvent: vi.fn((nextListener) => {
      listener = nextListener;
      return () => {};
    }),
  } as unknown as RpcClient;

  return { client, emit: (event: AgentSessionEvent) => listener(event) };
}

describe("PiRuntime", () => {
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
