import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mocks node:fs/promises so we can simulate the Windows file-lock race where
// the just-killed codex-acp process still holds the rollout handle and rename
// fails with EPERM/EACCES/EBUSY for a short window. writeFileWithRetry is
// internal, so we drive it through truncateCodexRollout.
const fsMock = vi.hoisted(() => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
}));
vi.mock("node:fs/promises", () => fsMock);

import { truncateCodexRollout } from "./rollout";

const sessionId = "retry-session";
const ROLLOUT = `${[
  JSON.stringify({ type: "session_meta", payload: {} }),
  JSON.stringify({ type: "event_msg", payload: { type: "task_started" } }),
  JSON.stringify({ type: "response_item", payload: { text: "t1" } }),
  JSON.stringify({ type: "event_msg", payload: { type: "task_complete" } }),
].join("\n")}\n`;

function errWithCode(code: string): NodeJS.ErrnoException {
  const e = new Error(code) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

describe("truncateCodexRollout file-lock retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.readdir.mockResolvedValue([
      {
        isFile: () => true,
        name: `rollout-x-${sessionId}.jsonl`,
        parentPath: "/fake/sessions/2026/06/08",
      },
    ]);
    fsMock.readFile.mockResolvedValue(ROLLOUT);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("retries on EPERM and succeeds once the lock releases", async () => {
    vi.useFakeTimers();
    fsMock.rename
      .mockRejectedValueOnce(errWithCode("EPERM"))
      .mockRejectedValueOnce(errWithCode("EBUSY"))
      .mockResolvedValueOnce(undefined);

    const p = truncateCodexRollout(sessionId, 1);
    await vi.runAllTimersAsync();
    const ok = await p;

    expect(ok).toBe(true);
    expect(fsMock.rename).toHaveBeenCalledTimes(3);
  });

  test("returns false after exhausting retries on a persistent lock", async () => {
    vi.useFakeTimers();
    fsMock.rename.mockRejectedValue(errWithCode("EACCES"));

    const p = truncateCodexRollout(sessionId, 1);
    await vi.runAllTimersAsync();
    const ok = await p;

    expect(ok).toBe(false);
    // delaysMs = [0, 50, 100, 200, 400, 800] → 6 attempts.
    expect(fsMock.rename).toHaveBeenCalledTimes(6);
  });

  test("fails fast on a non-lock error without retrying", async () => {
    vi.useFakeTimers();
    fsMock.rename.mockRejectedValue(errWithCode("ENOSPC"));

    const p = truncateCodexRollout(sessionId, 1);
    await vi.runAllTimersAsync();
    const ok = await p;

    expect(ok).toBe(false);
    expect(fsMock.rename).toHaveBeenCalledTimes(1);
  });
});
