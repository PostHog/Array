import { beforeEach, describe, expect, it, vi } from "vitest";

// The restore mutation guards against overlapping restores for the same
// session with an in-flight lock. A restore with no taskRunId skips the whole
// truncation block, so these tests only need to control the revert saga to
// exercise the lock's acquire/release behaviour.
const sagaRunMock = vi.hoisted(() => vi.fn());

vi.mock("@posthog/git/sagas/checkpoint", () => ({
  RevertCheckpointSaga: class {
    run = sagaRunMock;
  },
  deleteCheckpoint: vi.fn(),
}));

vi.mock("../../di/container", () => ({
  container: { get: vi.fn() },
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { checkpointRouter } from "./checkpoint";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
} {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("checkpointRouter.restore concurrency lock", () => {
  const caller = checkpointRouter.createCaller({});

  beforeEach(() => {
    sagaRunMock.mockReset();
  });

  it("rejects a second restore for the same repo while one is in flight", async () => {
    // First revert hangs so the first restore stays in flight and holds the lock.
    const gate = deferred<{ success: boolean }>();
    sagaRunMock.mockReturnValueOnce(gate.promise);

    const first = caller.restore({ checkpointId: "cp1", repoPath: "/repo" });
    await flushMicrotasks();

    await expect(
      caller.restore({ checkpointId: "cp2", repoPath: "/repo" }),
    ).rejects.toThrow(/already in progress/i);

    gate.resolve({ success: true });
    await expect(first).resolves.toEqual({
      restoredSessionId: undefined,
      truncationFailed: false,
    });
  });

  it("allows a different repo to restore concurrently", async () => {
    const gate = deferred<{ success: boolean }>();
    sagaRunMock.mockReturnValueOnce(gate.promise);
    sagaRunMock.mockResolvedValueOnce({ success: true });

    const first = caller.restore({ checkpointId: "cp1", repoPath: "/repo-a" });
    await flushMicrotasks();

    // Different repoPath → different lock key → not blocked.
    await expect(
      caller.restore({ checkpointId: "cp2", repoPath: "/repo-b" }),
    ).resolves.toEqual({
      restoredSessionId: undefined,
      truncationFailed: false,
    });

    gate.resolve({ success: true });
    await first;
  });

  it("releases the lock after a successful restore", async () => {
    sagaRunMock.mockResolvedValue({ success: true });

    await caller.restore({ checkpointId: "cp1", repoPath: "/repo" });
    await expect(
      caller.restore({ checkpointId: "cp2", repoPath: "/repo" }),
    ).resolves.toEqual({
      restoredSessionId: undefined,
      truncationFailed: false,
    });
  });

  it("releases the lock even when the revert fails", async () => {
    sagaRunMock.mockResolvedValueOnce({ success: false, error: "revert boom" });
    await expect(
      caller.restore({ checkpointId: "cp1", repoPath: "/repo" }),
    ).rejects.toThrow(/revert boom/);

    // Lock released by the finally block → a later restore proceeds.
    sagaRunMock.mockResolvedValueOnce({ success: true });
    await expect(
      caller.restore({ checkpointId: "cp2", repoPath: "/repo" }),
    ).resolves.toEqual({
      restoredSessionId: undefined,
      truncationFailed: false,
    });
  });
});
