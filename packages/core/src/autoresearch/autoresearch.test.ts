import type { AcpMessage, AgentSession } from "@posthog/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionStore, sessionStoreSetters } from "../sessions/sessionStore";
import { AutoresearchService } from "./autoresearch";
import {
  autoresearchStore,
  autoresearchStoreActions,
  getActiveRunForTask,
} from "./autoresearchStore";
import type { AutoresearchConfigInput, AutoresearchRun } from "./schemas";

const mockLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

let sentPrompts: Array<{ taskId: string; prompt: string }> = [];
let sendPromptImpl: (taskId: string, prompt: string) => Promise<void>;

const promptClient = {
  sendPrompt: vi.fn((taskId: string, prompt: string) => {
    sentPrompts.push({ taskId, prompt });
    return sendPromptImpl(taskId, prompt);
  }),
};

function makeService(): AutoresearchService {
  const service = new AutoresearchService();
  const s = service as unknown as Record<string, unknown>;
  s.rootLogger = { ...mockLog, scope: () => mockLog };
  s.promptClient = promptClient;
  return service;
}

const TASK_ID = "task-1";
const TASK_RUN_ID = "run-1";

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    taskRunId: TASK_RUN_ID,
    taskId: TASK_ID,
    taskTitle: "Optimize things",
    channel: "channel",
    events: [],
    startedAt: 0,
    status: "connected",
    isPromptPending: false,
    isCompacting: false,
    promptStartedAt: null,
    pendingPermissions: new Map(),
    pausedDurationMs: 0,
    messageQueue: [],
    optimisticItems: [],
    ...overrides,
  };
}

let eventTs = 0;

function promptEvent(): AcpMessage {
  eventTs += 1;
  return {
    type: "acp_message",
    ts: eventTs,
    message: {
      jsonrpc: "2.0",
      id: eventTs,
      method: "session/prompt",
      params: { prompt: [{ type: "text", text: "go" }] },
    },
  };
}

function agentChunkEvent(text: string): AcpMessage {
  eventTs += 1;
  return {
    type: "acp_message",
    ts: eventTs,
    message: {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      },
    },
  };
}

function reportText(value: number, summary = "tweak"): string {
  return `Done.\n\`\`\`autoresearch\nmetric: ${value}\nsummary: ${summary}\n\`\`\``;
}

/** Simulate the agent starting a turn on the task's session. */
function beginTurn(taskRunId = TASK_RUN_ID): void {
  sessionStoreSetters.updateSession(taskRunId, {
    isPromptPending: true,
    events: [
      ...(sessionStore.getState().sessions[taskRunId]?.events ?? []),
      promptEvent(),
    ],
  });
}

/** Simulate the agent finishing a turn that replied with `text`. */
function completeTurn(text: string, taskRunId = TASK_RUN_ID): void {
  const events = sessionStore.getState().sessions[taskRunId]?.events ?? [];
  sessionStoreSetters.updateSession(taskRunId, {
    isPromptPending: false,
    events: [...events, agentChunkEvent(text)],
  });
}

function runTurn(text: string, taskRunId = TASK_RUN_ID): void {
  beginTurn(taskRunId);
  completeTurn(text, taskRunId);
}

const baseConfig: AutoresearchConfigInput = {
  taskId: TASK_ID,
  metricName: "score",
  direction: "maximize",
  instructions: "Raise the score.",
};

function activeRun(): AutoresearchRun {
  const run = getActiveRunForTask(autoresearchStore.getState(), TASK_ID);
  if (!run) throw new Error("expected an active run");
  return run;
}

async function flushSends(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AutoresearchService", () => {
  let service: AutoresearchService;

  beforeEach(() => {
    vi.clearAllMocks();
    sentPrompts = [];
    sendPromptImpl = () => Promise.resolve();
    autoresearchStoreActions.reset();
    sessionStore.setState({ sessions: {}, taskIdIndex: {} });
    sessionStoreSetters.setSession(makeSession());
    service = makeService();
  });

  afterEach(() => {
    service.dispose();
  });

  describe("startRun", () => {
    it("registers a running run and sends the kickoff prompt", () => {
      const run = service.startRun(baseConfig);

      expect(run.status).toBe("running");
      expect(activeRun().id).toBe(run.id);
      expect(sentPrompts).toHaveLength(1);
      expect(sentPrompts[0].taskId).toBe(TASK_ID);
      expect(sentPrompts[0].prompt).toContain('"score"');
      expect(sentPrompts[0].prompt).toContain("```autoresearch");
    });

    it("rejects invalid configs", () => {
      expect(() =>
        service.startRun({ ...baseConfig, metricName: " " }),
      ).toThrow();
      expect(sentPrompts).toHaveLength(0);
    });

    it("refuses to start while a run is live for the task", () => {
      service.startRun(baseConfig);
      expect(() => service.startRun(baseConfig)).toThrow(/already running/);
    });

    it("allows a new run after the previous one ended", () => {
      const first = service.startRun(baseConfig);
      service.stopRun(first.id);

      const second = service.startRun(baseConfig);
      expect(second.id).not.toBe(first.id);
      expect(activeRun().id).toBe(second.id);
    });

    it("fails the run when the kickoff prompt cannot be sent", async () => {
      sendPromptImpl = () => Promise.reject(new Error("no session"));
      const run = service.startRun(baseConfig);
      await flushSends();

      const stored = autoresearchStore.getState().runs[run.id];
      expect(stored?.status).toBe("failed");
      expect(stored?.endReason).toBe("send-failed");
      expect(stored?.lastError).toBe("no session");
    });
  });

  describe("registerRun", () => {
    it("registers without sending — the kickoff rode the task's initial prompt", () => {
      const run = service.registerRun(baseConfig);

      expect(run.status).toBe("running");
      expect(activeRun().id).toBe(run.id);
      expect(sentPrompts).toHaveLength(0);
    });

    it("takes over the loop from the agent's first reply", () => {
      service.registerRun(baseConfig);
      runTurn(reportText(10, "baseline"));

      expect(activeRun().iterations).toHaveLength(1);
      expect(sentPrompts).toHaveLength(1);
      expect(sentPrompts[0].prompt).toContain("iteration 2");
    });

    it("shares the one-live-run-per-task guard with startRun", () => {
      service.registerRun(baseConfig);
      expect(() => service.startRun(baseConfig)).toThrow(/already running/);
    });
  });

  describe("iteration loop", () => {
    it("records an iteration and sends a continuation prompt", () => {
      service.startRun(baseConfig);
      runTurn(reportText(10, "baseline"));

      const run = activeRun();
      expect(run.iterations).toEqual([
        expect.objectContaining({
          index: 1,
          value: 10,
          bestValue: 10,
          delta: null,
          summary: "baseline",
        }),
      ]);
      expect(sentPrompts).toHaveLength(2);
      expect(sentPrompts[1].prompt).toContain("iteration 2");
      expect(sentPrompts[1].prompt).toContain("Best so far: 10 (iteration 1)");
    });

    it("tracks deltas and direction-aware best across iterations", () => {
      service.startRun({ ...baseConfig, direction: "minimize" });
      runTurn(reportText(100));
      runTurn(reportText(80));
      runTurn(reportText(95));

      const [first, second, third] = activeRun().iterations;
      expect(first).toMatchObject({ value: 100, bestValue: 100, delta: null });
      expect(second).toMatchObject({ value: 80, bestValue: 80, delta: -20 });
      expect(third).toMatchObject({ value: 95, bestValue: 80, delta: 15 });
    });

    it("completes when the target is reached and stops prompting", () => {
      service.startRun({ ...baseConfig, targetValue: 50 });
      runTurn(reportText(30));
      runTurn(reportText(55));

      const run = activeRun();
      expect(run.status).toBe("completed");
      expect(run.endReason).toBe("target-reached");
      expect(run.endedAt).not.toBeNull();
      // kickoff + one continuation after iteration 1, nothing after completion
      expect(sentPrompts).toHaveLength(2);
    });

    it("completes when the iteration budget is spent", () => {
      service.startRun({ ...baseConfig, maxIterations: 2 });
      runTurn(reportText(1));
      runTurn(reportText(2));

      const run = activeRun();
      expect(run.status).toBe("completed");
      expect(run.endReason).toBe("max-iterations");
      expect(sentPrompts).toHaveLength(2);
    });

    it("ignores turns on unrelated tasks", () => {
      sessionStoreSetters.setSession(
        makeSession({ taskId: "task-2", taskRunId: "run-2" }),
      );
      service.startRun(baseConfig);
      runTurn(reportText(10), "run-2");

      expect(activeRun().iterations).toHaveLength(0);
      expect(sentPrompts).toHaveLength(1);
    });

    it("does nothing after dispose", () => {
      service.startRun(baseConfig);
      service.dispose();
      runTurn(reportText(10));

      expect(activeRun().iterations).toHaveLength(0);
      expect(sentPrompts).toHaveLength(1);
    });
  });

  describe("missing reports", () => {
    it("reminds the agent once when a turn has no report", () => {
      service.startRun(baseConfig);
      runTurn("I made a change but forgot to measure.");

      const run = activeRun();
      expect(run.status).toBe("running");
      expect(run.iterations).toHaveLength(0);
      expect(sentPrompts).toHaveLength(2);
      expect(sentPrompts[1].prompt).toContain("did not include");
    });

    it("fails the run when the reminder also goes unanswered", () => {
      service.startRun(baseConfig);
      runTurn("no report");
      runTurn("still no report");

      const run = activeRun();
      expect(run.status).toBe("failed");
      expect(run.endReason).toBe("missing-report");
    });

    it("recovers when the reminder produces a report", () => {
      service.startRun(baseConfig);
      runTurn("no report");
      runTurn(reportText(42));

      expect(activeRun().status).toBe("running");
      expect(activeRun().iterations).toHaveLength(1);

      // The reminder budget is reset: a later lapse reminds again
      // instead of failing immediately.
      runTurn("oops, no report again");
      expect(activeRun().status).toBe("running");
      expect(sentPrompts.at(-1)?.prompt).toContain("did not include");
    });
  });

  describe("pause and resume", () => {
    it("records iterations while paused but does not continue the loop", () => {
      const run = service.startRun(baseConfig);
      service.pauseRun(run.id);
      runTurn(reportText(10));

      expect(activeRun().status).toBe("paused");
      expect(activeRun().iterations).toHaveLength(1);
      expect(sentPrompts).toHaveLength(1);
    });

    it("does not nag about missing reports while paused", () => {
      const run = service.startRun(baseConfig);
      service.pauseRun(run.id);
      runTurn("just chatting");

      expect(sentPrompts).toHaveLength(1);
      expect(activeRun().status).toBe("paused");
    });

    it("resume sends a continuation when the agent is idle", () => {
      const run = service.startRun(baseConfig);
      runTurn(reportText(10));
      service.pauseRun(run.id);
      sentPrompts = [];

      service.resumeRun(run.id);

      expect(activeRun().status).toBe("running");
      expect(sentPrompts).toHaveLength(1);
      expect(sentPrompts[0].prompt).toContain("iteration 2");
    });

    it("resume waits for the agent when a turn is in flight", () => {
      const run = service.startRun(baseConfig);
      service.pauseRun(run.id);
      beginTurn();
      sentPrompts = [];

      service.resumeRun(run.id);
      expect(sentPrompts).toHaveLength(0);

      completeTurn(reportText(10));
      expect(activeRun().iterations).toHaveLength(1);
      expect(sentPrompts).toHaveLength(1);
    });

    it("resume completes the run when it already met its end condition", () => {
      const run = service.startRun({ ...baseConfig, maxIterations: 1 });
      service.pauseRun(run.id);
      runTurn(reportText(10));

      service.resumeRun(run.id);

      expect(activeRun().status).toBe("completed");
      expect(activeRun().endReason).toBe("max-iterations");
      expect(sentPrompts).toHaveLength(1);
    });

    it("pause only applies to running runs", () => {
      const run = service.startRun(baseConfig);
      service.stopRun(run.id);
      service.pauseRun(run.id);
      expect(activeRun().status).toBe("stopped");
    });
  });

  describe("stop and session errors", () => {
    it("stopRun marks the run stopped and ends the loop", () => {
      const run = service.startRun(baseConfig);
      service.stopRun(run.id);
      runTurn(reportText(10));

      const stored = activeRun();
      expect(stored.status).toBe("stopped");
      expect(stored.endReason).toBe("stopped-by-user");
      expect(stored.iterations).toHaveLength(0);
      expect(sentPrompts).toHaveLength(1);
    });

    it("fails the run when the session errors out", () => {
      service.startRun(baseConfig);
      sessionStoreSetters.updateSession(TASK_RUN_ID, {
        status: "error",
        errorMessage: "agent crashed",
      });

      const run = activeRun();
      expect(run.status).toBe("failed");
      expect(run.endReason).toBe("session-error");
      expect(run.lastError).toBe("agent crashed");
    });

    it("fails the run when a continuation prompt cannot be sent", async () => {
      service.startRun(baseConfig);
      sendPromptImpl = () => Promise.reject(new Error("disconnected"));
      runTurn(reportText(10));
      await flushSends();

      const run = activeRun();
      expect(run.status).toBe("failed");
      expect(run.endReason).toBe("send-failed");
      expect(run.iterations).toHaveLength(1);
    });

    it("a late send failure does not overwrite an already-ended run", async () => {
      sendPromptImpl = () => Promise.reject(new Error("disconnected"));
      const run = service.startRun(baseConfig);
      // The user stops the run while the kickoff send is still in flight.
      service.stopRun(run.id);
      await flushSends();

      const stored = activeRun();
      expect(stored.status).toBe("stopped");
      expect(stored.endReason).toBe("stopped-by-user");
    });
  });
});
