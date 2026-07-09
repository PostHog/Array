import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";

// CheckpointService.restore guards against overlapping restores for the same
// session with an in-flight lock. A restore with no taskRunId skips the whole
// truncation block, so these tests only need to control the revert saga to
// exercise the lock's acquire/release behaviour — the agent/auth/logs deps are
// never touched on that path.
const sagaRunMock = vi.hoisted(() => vi.fn());

vi.mock("@posthog/git/sagas/checkpoint", () => ({
  RevertCheckpointSaga: class {
    run = sagaRunMock;
  },
  deleteCheckpoint: vi.fn(),
}));

import { POSTHOG_NOTIFICATIONS } from "@posthog/agent";
import { CheckpointService, trimReseededCacheToCheckpoint } from "./service";

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

describe("CheckpointService.restore concurrency lock", () => {
  // Deps are unused on the no-taskRunId path; stub them.
  const service = new CheckpointService({} as never, {} as never, {} as never);

  beforeEach(() => {
    sagaRunMock.mockReset();
  });

  it("rejects a second restore for the same repo while one is in flight", async () => {
    // First revert hangs so the first restore stays in flight and holds the lock.
    const gate = deferred<{ success: boolean }>();
    sagaRunMock.mockReturnValueOnce(gate.promise);

    const first = service.restore({ checkpointId: "cp1", repoPath: "/repo" });
    await flushMicrotasks();

    await expect(
      service.restore({ checkpointId: "cp2", repoPath: "/repo" }),
    ).rejects.toThrow(/already in progress/i);

    gate.resolve({ success: true });
    await expect(first).resolves.toEqual({
      restoredSessionId: undefined,
      truncationFailed: false,
      adapter: undefined,
    });
  });

  it("allows a different repo to restore concurrently", async () => {
    const gate = deferred<{ success: boolean }>();
    sagaRunMock.mockReturnValueOnce(gate.promise);
    sagaRunMock.mockResolvedValueOnce({ success: true });

    const first = service.restore({ checkpointId: "cp1", repoPath: "/repo-a" });
    await flushMicrotasks();

    // Different repoPath → different lock key → not blocked.
    await expect(
      service.restore({ checkpointId: "cp2", repoPath: "/repo-b" }),
    ).resolves.toEqual({
      restoredSessionId: undefined,
      truncationFailed: false,
      adapter: undefined,
    });

    gate.resolve({ success: true });
    await first;
  });

  it("releases the lock after a successful restore", async () => {
    sagaRunMock.mockResolvedValue({ success: true });

    await service.restore({ checkpointId: "cp1", repoPath: "/repo" });
    await expect(
      service.restore({ checkpointId: "cp2", repoPath: "/repo" }),
    ).resolves.toEqual({
      restoredSessionId: undefined,
      truncationFailed: false,
      adapter: undefined,
    });
  });

  it("releases the lock even when the revert fails", async () => {
    sagaRunMock.mockResolvedValueOnce({ success: false, error: "revert boom" });
    await expect(
      service.restore({ checkpointId: "cp1", repoPath: "/repo" }),
    ).rejects.toThrow(/revert boom/);

    // Lock released by the finally block → a later restore proceeds.
    sagaRunMock.mockResolvedValueOnce({ success: true });
    await expect(
      service.restore({ checkpointId: "cp2", repoPath: "/repo" }),
    ).resolves.toEqual({
      restoredSessionId: undefined,
      truncationFailed: false,
      adapter: undefined,
    });
  });
});

describe("trimReseededCacheToCheckpoint", () => {
  const msg = (timestamp: string, content: string) =>
    JSON.stringify({ type: "user", timestamp, content });
  const marker = (
    timestamp: string,
    checkpointId: string,
    extra: Record<string, unknown> = {},
  ) =>
    JSON.stringify({
      type: "notification",
      timestamp,
      notification: {
        jsonrpc: "2.0",
        method: POSTHOG_NOTIFICATIONS.GIT_CHECKPOINT,
        params: { checkpointId, ...extra },
      },
    });

  const contents = (log: string): string[] =>
    log
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .filter((e) => e.type === "user")
      .map((e) => e.content);

  it("cuts at the turn boundary (turnCompletedAt), not the late marker timestamp", () => {
    // The harness checkpoint's MARKER entry is stamped at capture-completion
    // (00:03:00) — well after alpha's prompt (00:00:05) because the snapshot was
    // slow. But its params.turnCompletedAt (00:00:01.5) is the true turn boundary.
    const log = [
      msg("2026-01-01T00:00:00.000Z", "harness"),
      msg("2026-01-01T00:00:05.000Z", "alpha"),
      marker("2026-01-01T00:03:00.000Z", "harness-cp", {
        promptId: 1,
        turnCompletedAt: "2026-01-01T00:00:01.500Z",
      }),
      marker("2026-01-01T00:06:00.000Z", "alpha-cp", {
        promptId: 2,
        turnCompletedAt: "2026-01-01T00:00:06.500Z",
      }),
    ].join("\n");

    const trimmed = trimReseededCacheToCheckpoint(log, "harness-cp");
    expect(trimmed).not.toBeNull();
    // alpha (sent during the slow snapshot) must be dropped; harness kept.
    expect(contents(trimmed as string)).toEqual(["harness"]);
    // The target marker is always kept so the restored turn stays restorable.
    expect(trimmed).toContain("harness-cp");
    expect(trimmed).not.toContain("alpha-cp");
  });

  it("falls back to the marker entry timestamp when turnCompletedAt is absent", () => {
    // Pre-fix / cloud-registered markers carry no turnCompletedAt. Behavior is
    // unchanged: boundary = the marker's (late) entry timestamp, so alpha — sent
    // before that timestamp — is still kept. Documents the fallback limitation.
    const log = [
      msg("2026-01-01T00:00:00.000Z", "harness"),
      msg("2026-01-01T00:00:05.000Z", "alpha"),
      marker("2026-01-01T00:03:00.000Z", "harness-cp", { promptId: 1 }),
    ].join("\n");

    const trimmed = trimReseededCacheToCheckpoint(log, "harness-cp");
    expect(trimmed).not.toBeNull();
    expect(contents(trimmed as string)).toEqual(["harness", "alpha"]);
  });

  it("keeps an EARLIER survivor's marker when restoring to a later checkpoint", () => {
    // Restoring to alpha (the later turn) must keep BOTH the harness and alpha
    // markers so both surviving turns stay restorable. This is the invariant the
    // survivor re-append in runRestore depends on: a survivor marker that the
    // position-based S3 truncate dropped is re-appended from the in-memory map
    // (with its true turnCompletedAt), and the trim must not then cut it back out.
    const log = [
      msg("2026-01-01T00:00:00.000Z", "harness"),
      msg("2026-01-01T00:00:05.000Z", "alpha"),
      marker("2026-01-01T00:03:00.000Z", "harness-cp", {
        promptId: 1,
        turnCompletedAt: "2026-01-01T00:00:01.500Z",
      }),
      // Re-appended at the log tail (restore time) but carrying alpha's true
      // turn boundary — the trim keys off turnCompletedAt, not this timestamp.
      marker("2026-01-01T09:00:00.000Z", "alpha-cp", {
        promptId: 2,
        turnCompletedAt: "2026-01-01T00:00:06.500Z",
      }),
    ].join("\n");

    const trimmed = trimReseededCacheToCheckpoint(log, "alpha-cp");
    expect(trimmed).not.toBeNull();
    expect(contents(trimmed as string)).toEqual(["harness", "alpha"]);
    // Both survivor markers survive → both turns keep their restore icons.
    expect(trimmed).toContain("harness-cp");
    expect(trimmed).toContain("alpha-cp");
  });

  it("returns null when the target checkpoint marker is not present", () => {
    const log = [
      msg("2026-01-01T00:00:00.000Z", "harness"),
      marker("2026-01-01T00:03:00.000Z", "other-cp", {
        turnCompletedAt: "2026-01-01T00:00:01.500Z",
      }),
    ].join("\n");
    expect(trimReseededCacheToCheckpoint(log, "harness-cp")).toBeNull();
  });
});
