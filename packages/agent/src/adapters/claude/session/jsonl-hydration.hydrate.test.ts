import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostHogAPIClient } from "../../../posthog-api";
import type { StoredEntry } from "../../../types";

// Mock fs so hydrateSessionJsonl's access/mkdir/writeFile/rename are observable
// without touching disk. The Claude checkpoint-restore memory truncation works
// by force-refetching the (already backend-truncated) S3 log and rewriting the
// JSONL — there is no session/update replay, so there is no duplication risk;
// these tests lock in that contract.
const fsMock = vi.hoisted(() => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
}));
vi.mock("node:fs/promises", () => fsMock);

import { hydrateSessionJsonl } from "./jsonl-hydration";

function s3Entry(
  sessionUpdate: string,
  extra: Record<string, unknown> = {},
): StoredEntry {
  return {
    type: "notification",
    timestamp: "2026-03-03T12:00:00.000Z",
    notification: {
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate, ...extra } },
    },
  };
}

function makeApi(overrides: {
  logUrl?: string | null;
  entries?: StoredEntry[];
}): PostHogAPIClient & {
  getTaskRun: ReturnType<typeof vi.fn>;
  fetchTaskRunLogs: ReturnType<typeof vi.fn>;
} {
  const api = {
    getTaskRun: vi.fn(async () => ({ log_url: overrides.logUrl ?? "s3://x" })),
    fetchTaskRunLogs: vi.fn(async () => overrides.entries ?? []),
  };
  return api as unknown as PostHogAPIClient & {
    getTaskRun: ReturnType<typeof vi.fn>;
    fetchTaskRunLogs: ReturnType<typeof vi.fn>;
  };
}

const log = { info: vi.fn(), warn: vi.fn() };

const baseParams = {
  sessionId: "sess-1",
  cwd: "/repo",
  taskId: "task-1",
  runId: "run-1",
  log,
};

describe("hydrateSessionJsonl checkpoint restore", () => {
  let prevConfigDir: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.rename.mockResolvedValue(undefined);
    prevConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = "/tmp/claude-hydrate-test";
  });

  afterEach(() => {
    if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevConfigDir;
  });

  it("reuses the existing JSONL without refetching when forceRefetch is false", async () => {
    fsMock.access.mockResolvedValue(undefined); // file exists
    const api = makeApi({ entries: [] });

    const ok = await hydrateSessionJsonl({ ...baseParams, posthogAPI: api });

    expect(ok).toBe(true);
    expect(api.getTaskRun).not.toHaveBeenCalled();
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it("force-refetches from truncated S3 even when a stale JSONL exists", async () => {
    fsMock.access.mockResolvedValue(undefined); // stale file exists
    // Truncated S3: only the first turn survives the checkpoint restore.
    const api = makeApi({
      entries: [
        s3Entry("user_message", {
          content: { type: "text", text: "greeting" },
        }),
        s3Entry("agent_message", { content: { type: "text", text: "done" } }),
      ],
    });

    const ok = await hydrateSessionJsonl({
      ...baseParams,
      posthogAPI: api,
      forceRefetch: true,
    });

    expect(ok).toBe(true);
    // The existing-file shortcut is bypassed; S3 is refetched and rewritten.
    expect(api.getTaskRun).toHaveBeenCalledTimes(1);
    expect(api.fetchTaskRunLogs).toHaveBeenCalledTimes(1);
    expect(fsMock.rename).toHaveBeenCalledTimes(1);

    // The rewritten JSONL contains only the surviving turn — memory parity:
    // truncated S3 in, truncated memory out.
    const written = fsMock.writeFile.mock.calls[0][1] as string;
    expect(written).toContain("greeting");
    expect(written).toContain("done");
    expect(written).not.toContain("post-checkpoint");
  });

  it("returns false when the task run has no log URL", async () => {
    fsMock.access.mockRejectedValue(
      Object.assign(new Error("nope"), { code: "ENOENT" }),
    );
    const api = makeApi({ logUrl: null });

    const ok = await hydrateSessionJsonl({
      ...baseParams,
      posthogAPI: api,
      forceRefetch: true,
    });

    expect(ok).toBe(false);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });
});
