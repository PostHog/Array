import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostHogAPIClient } from "./posthog-api";

const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

describe("PostHogAPIClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes once when fetching task run logs gets an auth failure", async () => {
    const getApiKey = vi.fn().mockResolvedValue("stale-token");
    const refreshApiKey = vi.fn().mockResolvedValue("fresh-token");
    const client = new PostHogAPIClient({
      apiUrl: "https://app.posthog.com",
      getApiKey,
      refreshApiKey,
      projectId: 1,
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      })
      .mockResolvedValueOnce({
        ok: true,
        text: vi
          .fn()
          .mockResolvedValue(
            `${JSON.stringify({ type: "notification", notification: { method: "foo" } })}\n`,
          ),
      });

    const logs = await client.fetchTaskRunLogs({
      id: "run-1",
      task: "task-1",
    } as never);

    expect(logs).toHaveLength(1);
    expect(getApiKey).toHaveBeenCalledTimes(1);
    expect(refreshApiKey).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("downloads artifacts through the backend endpoint", async () => {
    const client = new PostHogAPIClient({
      apiUrl: "https://app.posthog.com",
      getApiKey: vi.fn().mockResolvedValue("token"),
      projectId: 7,
    });
    const bytes = new TextEncoder().encode("hello world");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(bytes.buffer),
    });

    const artifact = await client.downloadArtifact(
      "task-1",
      "run-1",
      "tasks/artifacts/team_1/task_task-1/run_run-1/file.txt",
    );

    expect(artifact).toEqual(bytes.buffer);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://app.posthog.com/api/projects/7/tasks/task-1/runs/run-1/artifacts/download/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          storage_path: "tasks/artifacts/team_1/task_task-1/run_run-1/file.txt",
        }),
        headers: expect.any(Headers),
      }),
    );
  });

  it.each([
    [
      "includes message_id and text_parts when provided",
      ["part one", "final answer"],
      "msg-1",
      {
        text: "final answer",
        text_parts: ["part one", "final answer"],
        message_id: "msg-1",
      },
    ],
    [
      "omits optional fields when unknown",
      undefined,
      undefined,
      { text: "final answer" },
    ],
  ])(
    "relay_message body %s",
    async (_label, textParts, messageId, expectedBody) => {
      const client = new PostHogAPIClient({
        apiUrl: "https://app.posthog.com",
        getApiKey: vi.fn().mockResolvedValue("token"),
        projectId: 7,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ status: "ok" }),
      });

      await client.relayMessage(
        "task-1",
        "run-1",
        "final answer",
        textParts,
        messageId,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://app.posthog.com/api/projects/7/tasks/task-1/runs/run-1/relay_message/",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(expectedBody),
        }),
      );
    },
  );

  it("loads and syncs the durable task session", async () => {
    const client = new PostHogAPIClient({
      apiUrl: "https://app.posthog.com",
      getApiKey: vi.fn().mockResolvedValue("token"),
      projectId: 7,
    });
    const content = '{"type":"session"}\n';
    const access = {
      id: "session-1",
      download_url: "https://storage.example/session.jsonl",
      revision: 3,
    };
    const prepared = {
      id: "session-1",
      sync_id: "sync-1",
      upload: {
        url: "https://storage.example/upload",
        fields: { key: "task-sessions/session-1/uploads/4.jsonl" },
      },
    };
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(access),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue(content),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(prepared),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ id: "session-1", revision: 4 }),
      });

    const storage = await client.getTaskSession("task-1", "run-1");
    await expect(client.downloadTaskSession(storage)).resolves.toBe(content);
    await expect(
      client.syncTaskSession("task-1", "run-1", "sandbox-1", 3, content),
    ).resolves.toBe(4);

    expect(mockFetch).toHaveBeenNthCalledWith(
      4,
      "https://storage.example/upload",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
    expect(mockFetch).toHaveBeenLastCalledWith(
      "https://app.posthog.com/api/projects/7/tasks/task-1/runs/run-1/task_session_sync/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sandbox_id: "sandbox-1",
          sync_id: "sync-1",
          expected_revision: 3,
        }),
      }),
    );
  });

  it("recovers an ambiguous finalize only when its prepared object was promoted", async () => {
    const client = new PostHogAPIClient({
      apiUrl: "https://app.posthog.com",
      getApiKey: vi.fn().mockResolvedValue("token"),
      projectId: 7,
    });
    const prepared = {
      id: "session-1",
      sync_id: "sync-1",
      upload: {
        url: "https://storage.example/upload",
        fields: {
          key: "task-sessions/org/task/session/uploads/4-sync-1.jsonl",
        },
      },
    };
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(prepared),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: false,
        status: 504,
        json: vi.fn().mockResolvedValue({ error: "Gateway timeout" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: "session-1",
          revision: 4,
          download_url:
            "https://storage.example/task-sessions/org/task/session/revisions/4-sync-1.jsonl?signature=abc",
        }),
      });

    await expect(
      client.syncTaskSession(
        "task-1",
        "run-1",
        "sandbox-1",
        3,
        '{"type":"session"}\n',
      ),
    ).resolves.toBe(4);
  });

  it("rejects an ambiguous finalize when a competing revision was promoted", async () => {
    const client = new PostHogAPIClient({
      apiUrl: "https://app.posthog.com",
      getApiKey: vi.fn().mockResolvedValue("token"),
      projectId: 7,
    });
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: "session-1",
          sync_id: "sync-1",
          upload: {
            url: "https://storage.example/upload",
            fields: {
              key: "task-sessions/org/task/session/uploads/4-sync-1.jsonl",
            },
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: vi.fn().mockResolvedValue({ error: "Stale revision" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          id: "session-1",
          revision: 4,
          download_url:
            "https://storage.example/task-sessions/org/task/session/revisions/4-sync-2.jsonl?signature=abc",
        }),
      });

    await expect(
      client.syncTaskSession(
        "task-1",
        "run-1",
        "sandbox-1",
        3,
        '{"type":"session"}\n',
      ),
    ).rejects.toThrow("Stale revision");
  });

  it("returns only the artifacts created by the current upload request", async () => {
    const client = new PostHogAPIClient({
      apiUrl: "https://app.posthog.com",
      getApiKey: vi.fn().mockResolvedValue("token"),
      projectId: 1,
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        artifacts: [
          { storage_path: "gs://bucket/existing.tar.gz", name: "existing" },
          { storage_path: "gs://bucket/new-1.pack", name: "new-1" },
          { storage_path: "gs://bucket/new-2.index", name: "new-2" },
        ],
      }),
    });

    const artifacts = await client.uploadTaskArtifacts("task-1", "run-1", [
      { name: "new-1", type: "artifact", content: "AAA" },
      { name: "new-2", type: "artifact", content: "BBB" },
    ]);

    expect(artifacts).toEqual([
      { storage_path: "gs://bucket/new-1.pack", name: "new-1" },
      { storage_path: "gs://bucket/new-2.index", name: "new-2" },
    ]);
  });
});
