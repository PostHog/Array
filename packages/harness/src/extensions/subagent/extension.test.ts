import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const { runAgentMock, runPoolMock } = vi.hoisted(() => ({
  runAgentMock: vi.fn(),
  runPoolMock: vi.fn(),
}));

vi.mock("./run-agent", async () => {
  const actual =
    await vi.importActual<typeof import("./run-agent")>("./run-agent");
  return { ...actual, runAgent: runAgentMock };
});
vi.mock("./process/pool", () => ({ runPool: runPoolMock }));

import { createSubagentExtension } from "./extension";
import type { SingleRunResult } from "./run-agent";

function successResult(
  overrides: Partial<SingleRunResult> = {},
): SingleRunResult {
  return {
    runId: "test-run-id",
    agent: "scout",
    task: "look around",
    exitCode: 0,
    messages: [
      { role: "assistant", content: [{ type: "text", text: "done" }] } as never,
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
    ...overrides,
  };
}

async function getExecute() {
  let registered:
    | { execute: (...args: unknown[]) => Promise<unknown> }
    | undefined;
  const pi = {
    registerTool: (tool: {
      execute: (...args: unknown[]) => Promise<unknown>;
    }) => {
      registered = tool;
    },
    registerCommand: () => {},
    on: () => {},
    events: { on: () => {}, emit: () => {} },
  } as unknown as ExtensionAPI;
  createSubagentExtension()(pi);
  if (!registered) throw new Error("subagent tool was not registered");
  return registered.execute;
}

const fakeCtx = {
  cwd: "/repo",
  hasUI: true,
  isProjectTrusted: () => true,
  ui: { confirm: async () => true, input: vi.fn(async () => "human reply") },
};

describe("subagent tool", () => {
  beforeEach(() => {
    runAgentMock.mockReset();
    runPoolMock.mockReset();
  });

  it("errors when neither single nor parallel params are provided", async () => {
    const execute = await getExecute();
    const result = (await execute("id", {}, undefined, undefined, fakeCtx)) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Provide exactly one of/);
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it("errors when both single and parallel params are provided", async () => {
    const execute = await getExecute();
    const result = (await execute(
      "id",
      { agent: "scout", task: "x", tasks: [{ agent: "scout", task: "y" }] },
      undefined,
      undefined,
      fakeCtx,
    )) as { isError?: boolean };
    expect(result.isError).toBe(true);
  });

  it("errors on an unknown agent name in single mode", async () => {
    const execute = await getExecute();
    const result = (await execute(
      "id",
      { agent: "not-real", task: "x" },
      undefined,
      undefined,
      fakeCtx,
    )) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Unknown agent/);
  });

  it("errors when parallel tasks exceed the max count", async () => {
    const execute = await getExecute();
    const tasks = Array.from({ length: 9 }, () => ({
      agent: "scout",
      task: "x",
    }));
    const result = (await execute(
      "id",
      { tasks },
      undefined,
      undefined,
      fakeCtx,
    )) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Too many parallel tasks/);
    expect(runPoolMock).not.toHaveBeenCalled();
  });

  it("errors on an unknown agent name in a parallel task", async () => {
    const execute = await getExecute();
    const result = (await execute(
      "id",
      {
        tasks: [
          { agent: "scout", task: "x" },
          { agent: "not-real", task: "y" },
        ],
      },
      undefined,
      undefined,
      fakeCtx,
    )) as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Unknown agent/);
    expect(runPoolMock).not.toHaveBeenCalled();
  });

  it("dispatches single mode to runAgent and reports success", async () => {
    runAgentMock.mockResolvedValue(successResult());
    const execute = await getExecute();
    const result = (await execute(
      "id",
      { agent: "scout", task: "find auth code" },
      undefined,
      undefined,
      fakeCtx,
    )) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(runAgentMock).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("done");
  });

  it("reports failure when runAgent returns a failed result", async () => {
    runAgentMock.mockResolvedValue(
      successResult({ exitCode: 1, stopReason: "error", errorMessage: "boom" }),
    );
    const execute = await getExecute();
    const result = (await execute(
      "id",
      { agent: "scout", task: "x" },
      undefined,
      undefined,
      fakeCtx,
    )) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/boom/);
  });

  it("errors when chain has more steps than the max", async () => {
    const execute = await getExecute();
    const chain = Array.from({ length: 9 }, () => ({
      agent: "scout",
      task: "x",
    }));
    const result = (await execute(
      "id",
      { chain },
      undefined,
      undefined,
      fakeCtx,
    )) as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Too many chain steps/);
  });

  it("dispatches chain mode sequentially with {previous} substitution", async () => {
    runAgentMock
      .mockImplementationOnce(async ({ task }: { task: string }) =>
        successResult({ task, agent: "scout" }),
      )
      .mockImplementationOnce(async ({ task }: { task: string }) =>
        successResult({
          task,
          agent: "planner",
          messages: [
            {
              role: "assistant",
              content: [{ type: "text", text: task }],
            } as never,
          ],
        }),
      );

    const execute = await getExecute();
    const result = (await execute(
      "id",
      {
        chain: [
          { agent: "scout", task: "look around" },
          { agent: "planner", task: "plan for: {previous}" },
        ],
      },
      undefined,
      undefined,
      fakeCtx,
    )) as { isError?: boolean; content: Array<{ text: string }> };

    expect(runAgentMock).toHaveBeenCalledTimes(2);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("plan for: done");
  });

  it("dispatches parallel mode through runPool", async () => {
    const tasks = [
      { agent: "scout", task: "a" },
      { agent: "reviewer", task: "b" },
    ];
    runPoolMock.mockImplementation(
      async (
        items: typeof tasks,
        _opts: unknown,
        fn: (item: unknown, i: number, s: AbortSignal) => unknown,
      ) => {
        return Promise.all(
          items.map((item, i) => fn(item, i, new AbortController().signal)),
        );
      },
    );
    runAgentMock.mockImplementation(async ({ task }: { task: string }) =>
      successResult({ task }),
    );

    const execute = await getExecute();
    const result = (await execute(
      "id",
      { tasks },
      undefined,
      undefined,
      fakeCtx,
    )) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };

    expect(runPoolMock).toHaveBeenCalledTimes(1);
    expect(runAgentMock).toHaveBeenCalledTimes(2);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/Parallel: 2\/2 succeeded/);
  });

  it("background: true returns immediately with a runId instead of waiting for completion", async () => {
    const originalHome = process.env.HOME;
    const tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "posthog-subagent-ext-bg-"),
    );
    process.env.HOME = tmpHome;

    try {
      const gate = deferred<void>();
      runAgentMock.mockImplementation(async () => {
        await gate.promise;
        return successResult();
      });

      const execute = await getExecute();
      const result = (await execute(
        "id",
        { agent: "scout", task: "find auth code", background: true },
        undefined,
        undefined,
        fakeCtx,
      )) as { content: Array<{ text: string }>; details: { runId?: string } };

      expect(result.content[0].text).toMatch(/Started in background as run/);
      expect(result.details.runId).toBeTruthy();

      gate.resolve();
    } finally {
      process.env.HOME = originalHome;
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it("wires a live onSupervisorRequest through to ctx.ui.input in foreground single mode", async () => {
    fakeCtx.ui.input.mockClear();
    runAgentMock.mockImplementation(
      async ({
        onSupervisorRequest,
      }: {
        onSupervisorRequest?: (r: {
          reason: string;
          message: string;
        }) => Promise<string>;
      }) => {
        const reply = await onSupervisorRequest?.({
          reason: "need_decision",
          message: "proceed?",
        });
        expect(reply).toBe("human reply");
        return successResult();
      },
    );

    const execute = await getExecute();
    await execute(
      "id",
      { agent: "scout", task: "x" },
      undefined,
      undefined,
      fakeCtx,
    );

    expect(fakeCtx.ui.input).toHaveBeenCalledTimes(1);
  });

  it("does not pass onSupervisorRequest through for background runs", async () => {
    const originalHome = process.env.HOME;
    const tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "posthog-subagent-ext-bg-sup-"),
    );
    process.env.HOME = tmpHome;
    fakeCtx.ui.input.mockClear();

    try {
      const gate = deferred<void>();
      runAgentMock.mockImplementation(
        async ({ onSupervisorRequest }: { onSupervisorRequest?: unknown }) => {
          expect(onSupervisorRequest).toBeUndefined();
          await gate.promise;
          return successResult();
        },
      );

      const execute = await getExecute();
      await execute(
        "id",
        { agent: "scout", task: "x", background: true },
        undefined,
        undefined,
        fakeCtx,
      );
      gate.resolve();
      expect(fakeCtx.ui.input).not.toHaveBeenCalled();
    } finally {
      process.env.HOME = originalHome;
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
