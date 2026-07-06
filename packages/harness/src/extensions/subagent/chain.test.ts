import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runAgentMock } = vi.hoisted(() => ({ runAgentMock: vi.fn() }));
vi.mock("./run-agent", async () => {
  const actual =
    await vi.importActual<typeof import("./run-agent")>("./run-agent");
  return { ...actual, runAgent: runAgentMock };
});

import type { AgentConfig } from "./agents";
import { runChain } from "./chain";
import type { SingleRunResult } from "./run-agent";

const scout: AgentConfig = {
  name: "scout",
  description: "scout",
  systemPrompt: "scout",
  source: "bundled",
};
const planner: AgentConfig = {
  name: "planner",
  description: "planner",
  systemPrompt: "planner",
  source: "bundled",
};

function findAgent(name: string): AgentConfig | undefined {
  return [scout, planner].find((a) => a.name === name);
}

function successResult(task: string, text: string): SingleRunResult {
  return {
    runId: "test-run-id",
    agent: "scout",
    task,
    exitCode: 0,
    messages: [
      { role: "assistant", content: [{ type: "text", text }] } as never,
    ],
    stderr: "",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 1,
    },
  };
}

const fakeCtx = { cwd: "/repo" } as unknown as ExtensionContext;

describe("runChain", () => {
  beforeEach(() => {
    runAgentMock.mockReset();
  });

  it("runs steps in order, substituting {previous} with the prior step's output", async () => {
    runAgentMock
      .mockImplementationOnce(async ({ task }: { task: string }) =>
        successResult(task, "scout output"),
      )
      .mockImplementationOnce(async ({ task }: { task: string }) =>
        successResult(task, "planner output"),
      );

    const outcome = await runChain({
      ctx: fakeCtx,
      steps: [
        { agent: "scout", task: "find the auth code" },
        { agent: "planner", task: "plan based on: {previous}" },
      ],
      findAgent,
    });

    expect(outcome.results).toHaveLength(2);
    expect(runAgentMock.mock.calls[1][0].task).toBe(
      "plan based on: scout output",
    );
    expect(outcome.failedAtStep).toBeUndefined();
  });

  it("substitutes {previous} literally even when the prior output contains $-replacement patterns", async () => {
    const trickyOutput = 'ran: echo "done: $&" && echo $$ && backref $1';
    runAgentMock
      .mockImplementationOnce(async ({ task }: { task: string }) =>
        successResult(task, trickyOutput),
      )
      .mockImplementationOnce(async ({ task }: { task: string }) =>
        successResult(task, "done"),
      );

    await runChain({
      ctx: fakeCtx,
      steps: [
        { agent: "scout", task: "a" },
        { agent: "planner", task: "continue from: {previous}" },
      ],
      findAgent,
    });

    expect(runAgentMock.mock.calls[1][0].task).toBe(
      `continue from: ${trickyOutput}`,
    );
  });

  it("stops at the first failing step and does not run later steps", async () => {
    runAgentMock.mockImplementationOnce(async ({ task }: { task: string }) => ({
      ...successResult(task, ""),
      exitCode: 1,
      stopReason: "error",
      errorMessage: "boom",
    }));

    const outcome = await runChain({
      ctx: fakeCtx,
      steps: [
        { agent: "scout", task: "a" },
        { agent: "planner", task: "b" },
      ],
      findAgent,
    });

    expect(outcome.failedAtStep).toBe(1);
    expect(outcome.results).toHaveLength(1);
    expect(runAgentMock).toHaveBeenCalledTimes(1);
  });

  it("reports an unknown agent without calling runAgent for that step", async () => {
    const outcome = await runChain({
      ctx: fakeCtx,
      steps: [{ agent: "not-real", task: "a" }],
      findAgent,
    });

    expect(outcome.unknownAgent).toEqual({ step: 1, name: "not-real" });
    expect(runAgentMock).not.toHaveBeenCalled();
  });
});
