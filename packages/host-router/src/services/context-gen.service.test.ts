import type { AuthService } from "@posthog/core/auth/auth";
import type { ContextStreamEvent } from "@posthog/core/canvas/contextGenSchemas";
import { ContextGenEvent } from "@posthog/core/canvas/contextGenSchemas";
import type { RootLogger } from "@posthog/di/logger";
import { TypedEventEmitter } from "@posthog/shared";
import type { AgentService } from "@posthog/workspace-server/services/agent/agent";
import {
  AgentServiceEvent,
  type AgentServiceEvents,
} from "@posthog/workspace-server/services/agent/schemas";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextGenService } from "./context-gen.service";

// The forwarding loop drains agent frames on later event-loop turns, so give it
// a few macrotasks to translate buffered ACP frames into stream events.
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

// A controllable AgentService double: it records startSession calls and, when
// prompted, emits the ACP frames a real agent session would (so the service's
// forwarding loop has something to translate into stream events).
class FakeAgentService extends TypedEventEmitter<AgentServiceEvents> {
  startSession = vi.fn(async (_params: Record<string, unknown>) => {});
  cancelSession = vi.fn(async (_taskRunId: string) => {});
  prompt = vi.fn(async (taskRunId: string) => {
    this.emitUpdate(taskRunId, {
      sessionUpdate: "agent_message_chunk",
      content: { text: "Hello " },
    });
    this.emitUpdate(taskRunId, {
      sessionUpdate: "agent_message_chunk",
      content: { text: "world" },
    });
    this.emitUpdate(taskRunId, {
      sessionUpdate: "tool_call",
      title: "Read",
      status: "in_progress",
    });
  });

  private emitUpdate(taskRunId: string, update: Record<string, unknown>) {
    this.emit(AgentServiceEvent.SessionEvent, {
      taskRunId,
      payload: { message: { method: "session/update", params: { update } } },
    });
  }
}

const fakeAuth = {
  getValidAccessToken: vi.fn(async () => ({
    apiHost: "https://us.posthog.com",
  })),
  getState: vi.fn(() => ({ currentProjectId: 2 })),
} as unknown as AuthService;

const fakeLogger = {
  scope: () => ({ warn() {}, error() {}, debug() {}, info() {} }),
} as unknown as RootLogger;

function makeService() {
  const agent = new FakeAgentService();
  const service = new ContextGenService(
    agent as unknown as AgentService,
    fakeAuth,
    fakeLogger,
  );
  const events: ContextStreamEvent[] = [];
  service.on(ContextGenEvent.Event, (p) => {
    if (p.channelId === "c1") events.push(p.event);
  });
  return { agent, service, events };
}

describe("ContextGenService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts a session rooted at the given repo with writes denied", async () => {
    const { agent, service } = makeService();

    await service.generate({
      channelId: "c1",
      channelName: "Billing",
      repoPath: "/repos/app",
      systemPrompt: "system prompt",
    });

    expect(agent.startSession).toHaveBeenCalledTimes(1);
    const params = agent.startSession.mock.calls[0][0];
    expect(params).toMatchObject({
      taskId: "__preview__",
      taskRunId: "context:c1",
      repoPath: "/repos/app",
      projectId: 2,
      permissionMode: "bypassPermissions",
      systemPromptOverride: "system prompt",
    });
    expect(params.disallowedTools).toEqual(
      expect.arrayContaining(["Write", "Edit", "Bash", "WebFetch"]),
    );
  });

  it("forwards streamed prose, tool activity, and lifecycle events", async () => {
    const { service, events } = makeService();

    await service.generate({
      channelId: "c1",
      channelName: "Billing",
      repoPath: "/repos/app",
      systemPrompt: "system prompt",
    });
    await flush();

    expect(events).toContainEqual({ type: "started" });
    expect(events).toContainEqual({ type: "prose", text: "Hello " });
    expect(events).toContainEqual({ type: "prose", text: "world" });
    expect(events).toContainEqual({
      type: "tool",
      toolName: "Read",
      status: "in_progress",
    });
    expect(events).toContainEqual({ type: "done" });
  });

  it("emits an error event when the prompt fails", async () => {
    const { agent, service, events } = makeService();
    agent.prompt.mockRejectedValueOnce(new Error("boom"));

    await service.generate({
      channelId: "c1",
      channelName: "Billing",
      repoPath: "/repos/app",
      systemPrompt: "system prompt",
    });

    expect(events).toContainEqual({ type: "error", message: "boom" });
  });
});
