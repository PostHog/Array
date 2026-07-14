import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SqlV2PollOutcome } from "./sqlV2RunTracker";
import { SqlV2RunTracker } from "./sqlV2RunTracker";

interface Harness {
  tracker: SqlV2RunTracker;
  polls: string[];
  done: { runId: string; result: unknown }[];
  failed: { runId: string; error: string }[];
  disabledCount: () => number;
  queueOutcome: (...outcomes: SqlV2PollOutcome[]) => void;
  setPollImpl: (impl: (runId: string) => Promise<SqlV2PollOutcome>) => void;
}

function makeHarness(options?: { maxAttempts?: number }): Harness {
  const polls: string[] = [];
  const done: { runId: string; result: unknown }[] = [];
  const failed: { runId: string; error: string }[] = [];
  let disabled = 0;
  let queued: SqlV2PollOutcome[] = [];
  let pollImpl = (_runId: string): Promise<SqlV2PollOutcome> => {
    const next = queued.shift();
    return Promise.resolve(next ?? { status: "running" });
  };

  const tracker = new SqlV2RunTracker({
    poll: (runId) => {
      polls.push(runId);
      return pollImpl(runId);
    },
    onDone: (runId, result) => done.push({ runId, result }),
    onFailed: (runId, error) => failed.push({ runId, error }),
    onDisabled: () => {
      disabled += 1;
    },
    intervalMs: 1000,
    maxAttempts: options?.maxAttempts,
  });

  return {
    tracker,
    polls,
    done,
    failed,
    disabledCount: () => disabled,
    queueOutcome: (...outcomes) => {
      queued = [...queued, ...outcomes];
    },
    setPollImpl: (impl) => {
      pollImpl = impl;
    },
  };
}

async function flush(): Promise<void> {
  // Let promise callbacks queued by resolved polls run.
  await Promise.resolve();
  await Promise.resolve();
}

describe("SqlV2RunTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls immediately, then every interval, until done", async () => {
    const harness = makeHarness();
    harness.queueOutcome(
      { status: "running" },
      { status: "running" },
      { status: "done", result: { columns: ["a"] } },
    );
    harness.tracker.start("run-1");
    await flush();
    expect(harness.polls).toEqual(["run-1"]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.polls).toHaveLength(2);
    expect(harness.done).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.done).toEqual([
      { runId: "run-1", result: { columns: ["a"] } },
    ]);
    expect(harness.tracker.runningRunId).toBeNull();

    // Polling stopped after the terminal outcome.
    await vi.advanceTimersByTimeAsync(5000);
    expect(harness.polls).toHaveLength(3);
  });

  it("reports a failed run with its error", async () => {
    const harness = makeHarness();
    harness.queueOutcome({ status: "failed", error: "syntax error" });
    harness.tracker.start("run-1");
    await flush();
    expect(harness.failed).toEqual([{ runId: "run-1", error: "syntax error" }]);
  });

  it("defaults the failure message when the server omits it", async () => {
    const harness = makeHarness();
    harness.queueOutcome({ status: "failed", error: null });
    harness.tracker.start("run-1");
    await flush();
    expect(harness.failed[0]?.error).toBe("Run failed");
  });

  it("reports disabled and stops", async () => {
    const harness = makeHarness();
    harness.queueOutcome({ status: "disabled" });
    harness.tracker.start("run-1");
    await flush();
    expect(harness.disabledCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(harness.polls).toHaveLength(1);
  });

  it("times out after maxAttempts polls", async () => {
    const harness = makeHarness({ maxAttempts: 3 });
    harness.tracker.start("run-1");
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(harness.polls).toHaveLength(3);
    expect(harness.failed).toEqual([
      { runId: "run-1", error: "Timed out waiting for result" },
    ]);
    // No further polls after giving up.
    await vi.advanceTimersByTimeAsync(3000);
    expect(harness.polls).toHaveLength(3);
  });

  it("fails on a poll transport error", async () => {
    const harness = makeHarness();
    harness.setPollImpl(() => Promise.reject(new Error("network down")));
    harness.tracker.start("run-1");
    await flush();
    expect(harness.failed).toEqual([{ runId: "run-1", error: "network down" }]);
  });

  it("drops a stale in-flight response when a newer run supersedes it", async () => {
    const harness = makeHarness();
    let resolveFirst: (outcome: SqlV2PollOutcome) => void = () => {};
    harness.setPollImpl((runId) => {
      if (runId === "run-1") {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({ status: "done", result: { columns: ["b"] } });
    });

    harness.tracker.start("run-1");
    await flush();
    // First poll for run-1 is still in flight; a new run supersedes it.
    harness.tracker.start("run-2");
    await flush();

    // run-1's poll resolves "done" late — it must be discarded.
    resolveFirst({ status: "done", result: { columns: ["a"] } });
    await flush();
    expect(harness.done).toEqual([
      { runId: "run-2", result: { columns: ["b"] } },
    ]);
    expect(harness.tracker.runningRunId).toBeNull();
  });

  it("skips a tick while a poll is still in flight instead of queueing", async () => {
    const harness = makeHarness();
    let resolvePoll: (outcome: SqlV2PollOutcome) => void = () => {};
    harness.setPollImpl(
      () =>
        new Promise((resolve) => {
          resolvePoll = resolve;
        }),
    );
    harness.tracker.start("run-1");
    await flush();
    expect(harness.polls).toHaveLength(1);

    // Two intervals pass with the first poll unresolved — no extra polls.
    await vi.advanceTimersByTimeAsync(2000);
    expect(harness.polls).toHaveLength(1);

    resolvePoll({ status: "running" });
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.polls).toHaveLength(2);
  });

  it("stop() halts polling without callbacks", async () => {
    const harness = makeHarness();
    harness.tracker.start("run-1");
    await flush();
    harness.tracker.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(harness.polls).toHaveLength(1);
    expect(harness.done).toHaveLength(0);
    expect(harness.failed).toHaveLength(0);
  });
});
