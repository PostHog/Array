import type { PiRemoteRpcClient } from "@posthog/agent/pi/remote-rpc-client";
import type { TaskService } from "@posthog/core/task-detail/taskService";
import type { AgentConversationEvent } from "@posthog/shared";
import { describe, expect, it, vi } from "vitest";
import {
  type PiSession,
  PiSessionController,
  type PiSessionProvider,
} from "./piSessionController";

function createController(
  session = createSession(),
  taskService = {
    openTask: vi.fn(async () => ({ success: true })),
  } as unknown as TaskService,
): PiSessionController {
  const provider: PiSessionProvider = {
    get: vi.fn(async () => session),
  };
  return new PiSessionController(provider, taskService);
}

function createSession(): PiSession {
  const client = {
    getState: vi.fn(async () => ({
      thinkingLevel: "off" as const,
      isStreaming: false,
      isCompacting: false,
      steeringMode: "all" as const,
      followUpMode: "all" as const,
      sessionId: "session-1",
      autoCompactionEnabled: true,
      messageCount: 0,
      pendingMessageCount: 0,
    })),
    getAvailableModels: vi.fn(async () => []),
    getAvailableThinkingLevels: vi.fn(async () => ["off" as const]),
    getCommands: vi.fn(async () => []),
    prompt: vi.fn(async () => {}),
    steer: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    compact: vi.fn(async () => undefined),
    setModel: vi.fn(async (provider, id) => ({ provider, id })),
    setThinkingLevel: vi.fn(async () => {}),
    setSteeringMode: vi.fn(async () => {}),
    setFollowUpMode: vi.fn(async () => {}),
    bash: vi.fn(async () => undefined),
    abort: vi.fn(async () => {}),
    abortBash: vi.fn(async () => {}),
  } as unknown as PiRemoteRpcClient;

  return {
    client,
    health: vi.fn(async () => ({ state: "idle" as const })),
    getConversation: vi.fn(async () => []),
    onConversationEvent: vi.fn(() => () => {}),
  };
}

describe("PiSessionController", () => {
  it.each([
    {
      text: "hello",
      streaming: false,
      mode: "steer" as const,
      action: "prompt",
    },
    { text: "hello", streaming: true, mode: "steer" as const, action: "steer" },
    {
      text: "hello",
      streaming: true,
      mode: "queue" as const,
      action: "followUp",
    },
    {
      text: "/compact keep details",
      streaming: false,
      mode: "steer" as const,
      action: "compact",
    },
  ])("classifies $action submissions", ({ text, streaming, mode, action }) => {
    const controller = createController();

    expect(controller.getSubmitAction(text, streaming, mode)).toBe(action);
  });

  it.each([
    {
      text: "hello",
      streaming: false,
      mode: "steer" as const,
      method: "prompt" as const,
      expectedArgs: ["hello"],
    },
    {
      text: "hello",
      streaming: true,
      mode: "steer" as const,
      method: "steer" as const,
      expectedArgs: ["hello"],
    },
    {
      text: "hello",
      streaming: true,
      mode: "queue" as const,
      method: "followUp" as const,
      expectedArgs: ["hello"],
    },
    {
      text: "/compact keep details",
      streaming: false,
      mode: "steer" as const,
      method: "compact" as const,
      expectedArgs: ["keep details"],
    },
  ])("routes submissions through $method", async (input) => {
    const client = createSession();
    const controller = createController(client);

    await controller.submit("task-1", input.text, input.streaming, input.mode);

    expect(client.client[input.method]).toHaveBeenCalledWith(
      ...input.expectedArgs,
    );
  });

  it("keeps a connected transcript usable when a command fails", async () => {
    const initialEvent: AgentConversationEvent = {
      type: "user_message",
      id: "message-1",
      timestamp: 1,
      content: [{ type: "text", text: "hello" }],
    };
    const session = createSession();
    vi.mocked(session.getConversation).mockResolvedValue([initialEvent]);
    vi.mocked(session.client.prompt).mockRejectedValue(
      new Error("temporary command failure"),
    );
    const controller = createController(session);

    await controller.connect("task-1");
    await expect(
      controller.submit("task-1", "retry me", false, "steer"),
    ).rejects.toThrow("temporary command failure");

    expect(controller.store.getState().sessions["task-1"]).toMatchObject({
      connectionState: "connected",
      events: [initialEvent],
      error: undefined,
    });
  });

  it("owns and releases the bound session lifetime", async () => {
    const session = createSession();
    const provider: PiSessionProvider = {
      get: vi.fn(async () => session),
    };
    const controller = new PiSessionController(provider, {} as TaskService);

    await controller.ensureConnected("task-1");
    await controller.setThinkingLevel("task-1", "high");

    expect(provider.get).toHaveBeenCalledOnce();

    controller.disconnect("task-1");
    await controller.ensureConnected("task-1");

    expect(provider.get).toHaveBeenCalledTimes(2);
  });

  it("opens cold tasks before connecting", async () => {
    const client = createSession();
    vi.mocked(client.health).mockResolvedValue({ state: "cold" });
    const openTask = vi.fn(async () => ({ success: true }));
    const taskService = { openTask } as unknown as TaskService;
    const controller = createController(client, taskService);

    await controller.ensureConnected("task-1", "run-1");

    expect(openTask).toHaveBeenCalledWith("task-1", "run-1");
    expect(controller.store.getState().sessions["task-1"]).toMatchObject({
      connectionState: "connected",
    });
  });

  it("refreshes native thinking levels after changing models", async () => {
    const session = createSession();
    const client = session.client;
    vi.mocked(client.getState).mockResolvedValue({
      thinkingLevel: "high",
      isStreaming: false,
      isCompacting: false,
      steeringMode: "all",
      followUpMode: "all",
      sessionId: "session-1",
      autoCompactionEnabled: true,
      messageCount: 0,
      pendingMessageCount: 0,
      model: {
        provider: "posthog",
        id: "model-2",
        name: "Model 2",
        api: "anthropic-messages",
        baseUrl: "https://example.com",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 8_000,
      },
    });
    vi.mocked(client.getAvailableModels).mockResolvedValue([
      {
        provider: "posthog",
        id: "model-1",
        contextWindow: 100_000,
        reasoning: true,
      },
      {
        provider: "posthog",
        id: "model-2",
        contextWindow: 200_000,
        reasoning: true,
      },
    ]);
    vi.mocked(client.getAvailableThinkingLevels).mockResolvedValue([
      "off",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    const controller = createController(session);
    await controller.ensureConnected("task-1");

    await controller.setModel("task-1", {
      provider: "posthog",
      id: "model-2",
      contextWindow: 200_000,
      reasoning: true,
    });

    const state = controller.store.getState().sessions["task-1"];
    expect(state?.models).toEqual([
      expect.objectContaining({ id: "model-1" }),
      expect.objectContaining({ id: "model-2" }),
    ]);
    expect(state?.thinkingLevels).toEqual([
      "off",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("makes the transcript available before model discovery finishes", async () => {
    let resolveModels: (models: []) => void = () => {};
    const models = new Promise<[]>((resolve) => {
      resolveModels = resolve;
    });
    const initialEvent: AgentConversationEvent = {
      type: "assistant_thought_chunk",
      timestamp: 1,
      content: { type: "text", text: "working" },
    };
    const client = createSession();
    vi.mocked(client.getConversation).mockResolvedValue([initialEvent]);
    vi.mocked(client.client.getState).mockResolvedValue({
      thinkingLevel: "high",
      isStreaming: true,
      isCompacting: false,
      steeringMode: "all",
      followUpMode: "all",
      sessionId: "session-1",
      autoCompactionEnabled: true,
      messageCount: 1,
      pendingMessageCount: 0,
    });
    vi.mocked(client.client.getAvailableModels).mockReturnValue(models);
    const controller = createController(client);

    const connection = controller.connect("task-1");

    await vi.waitFor(() => {
      expect(controller.store.getState().sessions["task-1"]).toMatchObject({
        events: [initialEvent],
        status: { isStreaming: true },
      });
    });

    resolveModels([]);
    await connection;
  });

  it("reconciles structurally equal live events included in native history", async () => {
    const nativeEvent: AgentConversationEvent = {
      type: "user_message",
      id: "native-message-id",
      timestamp: 1,
      content: [{ type: "text", text: "hello" }],
    };
    const liveEvent: AgentConversationEvent = {
      ...nativeEvent,
      id: "live-message-id",
      content: [{ type: "text", text: "hello" }],
    };
    let resolveConversation: (events: AgentConversationEvent[]) => void =
      () => {};
    const conversation = new Promise<AgentConversationEvent[]>((resolve) => {
      resolveConversation = resolve;
    });
    let onEvent: (event: AgentConversationEvent) => void = () => {};
    let subscribed = false;
    const session = createSession();
    vi.mocked(session.getConversation).mockReturnValue(conversation);
    vi.mocked(session.onConversationEvent).mockImplementation((handler) => {
      onEvent = handler;
      subscribed = true;
      return () => {};
    });
    const controller = createController(session);

    const connection = controller.connect("task-1");
    await vi.waitFor(() => expect(subscribed).toBe(true));
    onEvent(liveEvent);
    resolveConversation([nativeEvent]);
    await connection;

    expect(controller.store.getState().sessions["task-1"].events).toEqual([
      nativeEvent,
    ]);
  });

  it("does not append streamed assistant text already present in native history", async () => {
    const nativeEvent: AgentConversationEvent = {
      type: "assistant_message_chunk",
      timestamp: 1,
      content: { type: "text", text: "hello world" },
    };
    const liveEvent: AgentConversationEvent = {
      type: "assistant_message_chunk",
      timestamp: 1,
      content: { type: "text", text: "world" },
    };
    let resolveConversation: (events: AgentConversationEvent[]) => void =
      () => {};
    const conversation = new Promise<AgentConversationEvent[]>((resolve) => {
      resolveConversation = resolve;
    });
    let onEvent: (event: AgentConversationEvent) => void = () => {};
    let subscribed = false;
    const session = createSession();
    vi.mocked(session.getConversation).mockReturnValue(conversation);
    vi.mocked(session.onConversationEvent).mockImplementation((handler) => {
      onEvent = handler;
      subscribed = true;
      return () => {};
    });
    const controller = createController(session);

    const connection = controller.connect("task-1");
    await vi.waitFor(() => expect(subscribed).toBe(true));
    onEvent(liveEvent);
    resolveConversation([nativeEvent]);
    await connection;

    expect(controller.store.getState().sessions["task-1"].events).toEqual([
      nativeEvent,
    ]);
  });

  it("does not let an older load overwrite a newer live refresh", async () => {
    const nativeEvent: AgentConversationEvent = {
      type: "user_message",
      id: "message-1",
      timestamp: 1,
      content: [{ type: "text", text: "newer history" }],
    };
    const turnCompleted: AgentConversationEvent = {
      type: "turn_completed",
      timestamp: 2,
    };
    let resolveInitialConversation: (events: AgentConversationEvent[]) => void =
      () => {};
    const initialConversation = new Promise<AgentConversationEvent[]>(
      (resolve) => {
        resolveInitialConversation = resolve;
      },
    );
    let onEvent: (event: AgentConversationEvent) => void = () => {};
    let subscribed = false;
    const session = createSession();
    vi.mocked(session.getConversation)
      .mockReturnValueOnce(initialConversation)
      .mockResolvedValueOnce([nativeEvent, turnCompleted]);
    vi.mocked(session.onConversationEvent).mockImplementation((handler) => {
      onEvent = handler;
      subscribed = true;
      return () => {};
    });
    const controller = createController(session);

    const connection = controller.connect("task-1");
    await vi.waitFor(() => expect(subscribed).toBe(true));
    onEvent(turnCompleted);
    await vi.waitFor(() =>
      expect(controller.store.getState().sessions["task-1"].events).toEqual([
        nativeEvent,
        turnCompleted,
      ]),
    );
    resolveInitialConversation([]);
    await connection;

    expect(controller.store.getState().sessions["task-1"].events).toEqual([
      nativeEvent,
      turnCompleted,
    ]);
  });

  it("drops retained live events when reconnecting after disconnect", async () => {
    const liveEvent: AgentConversationEvent = {
      type: "assistant_message_chunk",
      timestamp: 1,
      content: { type: "text", text: "stale" },
    };
    let onEvent: (event: AgentConversationEvent) => void = () => {};
    const session = createSession();
    vi.mocked(session.onConversationEvent).mockImplementation((handler) => {
      onEvent = handler;
      return () => {};
    });
    const controller = createController(session);

    await controller.connect("task-1");
    onEvent(liveEvent);
    controller.disconnect("task-1");
    await controller.connect("task-1");

    expect(controller.store.getState().sessions["task-1"].events).toEqual([]);
  });

  it("catches conversation refresh failures triggered by live events", async () => {
    const turnCompleted: AgentConversationEvent = {
      type: "turn_completed",
      timestamp: 1,
    };
    let onEvent: (event: AgentConversationEvent) => void = () => {};
    const session = createSession();
    vi.mocked(session.onConversationEvent).mockImplementation((handler) => {
      onEvent = handler;
      return () => {};
    });
    const controller = createController(session);

    await controller.connect("task-1");
    vi.mocked(session.getConversation).mockRejectedValueOnce(
      new Error("refresh failed"),
    );
    onEvent(turnCompleted);
    await vi.waitFor(() =>
      expect(session.getConversation).toHaveBeenCalledTimes(2),
    );

    expect(controller.store.getState().sessions["task-1"].events).toEqual([
      turnCompleted,
    ]);
  });

  it("loads session state and appends normalized runtime events", async () => {
    const initialEvent: AgentConversationEvent = {
      type: "assistant_message_chunk",
      timestamp: 1,
      content: { type: "text", text: "hello" },
    };
    const liveEvent: AgentConversationEvent = {
      type: "runtime_status",
      timestamp: 2,
      status: "compacting",
    };
    let onEvent: (event: AgentConversationEvent) => void = () => {};
    const client = createSession();
    vi.mocked(client.getConversation).mockResolvedValue([initialEvent]);
    vi.mocked(client.onConversationEvent).mockImplementation((handler) => {
      onEvent = handler;
      return () => {};
    });
    const controller = createController(client);

    await controller.connect("task-1");
    onEvent(liveEvent);

    expect(controller.store.getState().sessions["task-1"]).toMatchObject({
      events: [initialEvent, liveEvent],
      status: { isCompacting: true },
    });
  });
});
