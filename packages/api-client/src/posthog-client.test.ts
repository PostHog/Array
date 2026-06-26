import { describe, expect, it, vi } from "vitest";
import { PostHogAPIClient } from "./posthog-client";

describe("PostHogAPIClient", () => {
  it("sends supported reasoning effort for cloud Codex runs", async () => {
    const client = new PostHogAPIClient(
      "http://localhost:8000",
      async () => "token",
      async () => "token",
      123,
    );

    const post = vi.fn().mockResolvedValue({
      id: "task-123",
      title: "Task",
      description: "Task",
      created_at: "2026-04-14T00:00:00Z",
      updated_at: "2026-04-14T00:00:00Z",
      origin_product: "user_created",
    });

    (client as unknown as { api: { post: typeof post } }).api = { post };

    await client.runTaskInCloud("task-123", "feature/max-effort", {
      adapter: "codex",
      model: "gpt-5.4",
      reasoningLevel: "high",
    });

    expect(post).toHaveBeenCalledWith(
      "/api/projects/{project_id}/tasks/{id}/run/",
      expect.objectContaining({
        path: { project_id: "123", id: "task-123" },
        body: expect.objectContaining({
          mode: "interactive",
          branch: "feature/max-effort",
          runtime_adapter: "codex",
          model: "gpt-5.4",
          reasoning_effort: "high",
        }),
      }),
    );
  });

  it("preserves Codex-native permission modes for cloud runs", async () => {
    const client = new PostHogAPIClient(
      "http://localhost:8000",
      async () => "token",
      async () => "token",
      123,
    );

    const post = vi.fn().mockResolvedValue({
      id: "task-123",
      title: "Task",
      description: "Task",
      created_at: "2026-04-14T00:00:00Z",
      updated_at: "2026-04-14T00:00:00Z",
      origin_product: "user_created",
    });

    (client as unknown as { api: { post: typeof post } }).api = { post };

    await client.runTaskInCloud("task-123", "feature/codex-mode", {
      adapter: "codex",
      model: "gpt-5.4",
      initialPermissionMode: "auto",
    });

    expect(post).toHaveBeenCalledWith(
      "/api/projects/{project_id}/tasks/{id}/run/",
      expect.objectContaining({
        body: expect.objectContaining({
          initial_permission_mode: "auto",
        }),
      }),
    );
  });

  it("rejects unsupported reasoning effort for cloud Codex runs", async () => {
    const client = new PostHogAPIClient(
      "http://localhost:8000",
      async () => "token",
      async () => "token",
      123,
    );

    const post = vi.fn();
    (client as unknown as { api: { post: typeof post } }).api = { post };

    await expect(
      client.runTaskInCloud("task-123", "feature/max-effort", {
        adapter: "codex",
        model: "gpt-5.4",
        reasoningLevel: "max",
      }),
    ).rejects.toThrow(
      "Reasoning effort 'max' is not supported for codex model 'gpt-5.4'.",
    );

    expect(post).not.toHaveBeenCalled();
  });

  it("rejects unsupported minimal reasoning effort for cloud runs", async () => {
    const client = new PostHogAPIClient(
      "http://localhost:8000",
      async () => "token",
      async () => "token",
      123,
    );

    const post = vi.fn();
    (client as unknown as { api: { post: typeof post } }).api = { post };

    await expect(
      client.runTaskInCloud("task-123", "feature/legacy-effort", {
        adapter: "claude",
        model: "claude-opus-4-8",
        reasoningLevel: "minimal",
      }),
    ).rejects.toThrow(
      "Reasoning effort 'minimal' is not supported for claude model 'claude-opus-4-8'.",
    );

    expect(post).not.toHaveBeenCalled();
  });

  it("creates cloud task runs without relying on generated request typing", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "run-123", environment: "cloud" }),
    });
    const client = new PostHogAPIClient(
      "http://localhost:8000",
      async () => "token",
      async () => "token",
      123,
    );

    (
      client as unknown as {
        api: { baseUrl: string; fetcher: { fetch: typeof fetch } };
      }
    ).api = {
      baseUrl: "http://localhost:8000",
      fetcher: { fetch },
    };

    await expect(
      client.createTaskRun("task-123", {
        environment: "cloud",
        mode: "interactive",
        branch: "feature/direct-upload",
        adapter: "codex",
        model: "gpt-5.4",
        reasoningLevel: "high",
        initialPermissionMode: "auto",
      }),
    ).resolves.toEqual({ id: "run-123", environment: "cloud" });

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "post",
        path: "/api/projects/123/tasks/task-123/runs/",
        overrides: {
          body: JSON.stringify({
            mode: "interactive",
            branch: "feature/direct-upload",
            runtime_adapter: "codex",
            model: "gpt-5.4",
            reasoning_effort: "high",
            initial_permission_mode: "auto",
            environment: "cloud",
          }),
        },
      }),
    );
  });

  it("starts an existing cloud task run with run-scoped artifact ids", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "task-123", latest_run: { id: "run-123" } }),
    });
    const client = new PostHogAPIClient(
      "http://localhost:8000",
      async () => "token",
      async () => "token",
      123,
    );

    (
      client as unknown as {
        api: { baseUrl: string; fetcher: { fetch: typeof fetch } };
      }
    ).api = {
      baseUrl: "http://localhost:8000",
      fetcher: { fetch },
    };

    await expect(
      client.startTaskRun("task-123", "run-123", {
        pendingUserMessage: "Read the attached file first",
        pendingUserArtifactIds: ["artifact-1"],
      }),
    ).resolves.toEqual({ id: "task-123", latest_run: { id: "run-123" } });

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "post",
        path: "/api/projects/123/tasks/task-123/runs/run-123/start/",
        overrides: {
          body: JSON.stringify({
            pending_user_message: "Read the attached file first",
            pending_user_artifact_ids: ["artifact-1"],
          }),
        },
      }),
    );
  });

  describe("warmTask", () => {
    function makeClient(fetch: ReturnType<typeof vi.fn>) {
      const client = new PostHogAPIClient(
        "http://localhost:8000",
        async () => "token",
        async () => "token",
        123,
      );
      (
        client as unknown as {
          api: { baseUrl: string; fetcher: { fetch: typeof fetch } };
        }
      ).api = { baseUrl: "http://localhost:8000", fetcher: { fetch } };
      return client;
    }

    it("posts the repository + integration + branch and returns the warm run identifiers", async () => {
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({ task_id: "task-1", run_id: "run-1" }),
      });
      const client = makeClient(fetch);

      await expect(
        client.warmTask({
          repository: "PostHog/posthog",
          github_integration: 42,
          branch: "feature/warm",
        }),
      ).resolves.toEqual({ task_id: "task-1", run_id: "run-1" });

      expect(fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "post",
          path: "/api/projects/123/tasks/warm/",
          overrides: {
            body: JSON.stringify({
              repository: "PostHog/posthog",
              github_integration: 42,
              branch: "feature/warm",
              runtime_adapter: null,
              model: null,
              reasoning_effort: null,
            }),
          },
        }),
      );
    });

    it("forwards the selected runtime so the warm Run starts on it", async () => {
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({ task_id: "task-1", run_id: "run-1" }),
      });
      const client = makeClient(fetch);

      await client.warmTask({
        repository: "PostHog/posthog",
        github_integration: 42,
        branch: "feature/warm",
        runtime_adapter: "codex",
        model: "gpt-5.5",
        reasoning_effort: "high",
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          overrides: {
            body: JSON.stringify({
              repository: "PostHog/posthog",
              github_integration: 42,
              branch: "feature/warm",
              runtime_adapter: "codex",
              model: "gpt-5.5",
              reasoning_effort: "high",
            }),
          },
        }),
      );
    });

    it("sends a null branch when none is provided", async () => {
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({ task_id: "task-1", run_id: "run-1" }),
      });
      const client = makeClient(fetch);

      await client.warmTask({
        repository: "PostHog/posthog",
        github_integration: 42,
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          overrides: {
            body: JSON.stringify({
              repository: "PostHog/posthog",
              github_integration: 42,
              branch: null,
              runtime_adapter: null,
              model: null,
              reasoning_effort: null,
            }),
          },
        }),
      );
    });

    it("returns null on an empty 200 body (feature disabled / capped / no-op)", async () => {
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "",
      });
      const client = makeClient(fetch);

      await expect(
        client.warmTask({
          repository: "PostHog/posthog",
          github_integration: 42,
        }),
      ).resolves.toBeNull();
    });

    it("throws on a non-ok response", async () => {
      const fetch = vi
        .fn()
        .mockResolvedValue({ ok: false, statusText: "Bad Request" });
      const client = makeClient(fetch);

      await expect(
        client.warmTask({
          repository: "PostHog/posthog",
          github_integration: 42,
        }),
      ).rejects.toThrow("Bad Request");
    });
  });

  describe("getSignalReport", () => {
    function makeClient(fetch: ReturnType<typeof vi.fn>) {
      const client = new PostHogAPIClient(
        "http://localhost:8000",
        async () => "token",
        async () => "token",
        123,
      );
      (
        client as unknown as {
          api: { baseUrl: string; fetcher: { fetch: typeof fetch } };
        }
      ).api = {
        baseUrl: "http://localhost:8000",
        fetcher: { fetch },
      };
      return client;
    }

    it("returns the parsed report on success", async () => {
      const fetch = vi.fn().mockResolvedValue({
        json: async () => ({ id: "abc", title: "hi" }),
      });
      const client = makeClient(fetch);

      await expect(client.getSignalReport("abc")).resolves.toEqual({
        id: "abc",
        title: "hi",
      });
    });

    it("returns null when the shared fetcher throws a 404", async () => {
      const fetch = vi
        .fn()
        .mockRejectedValue(
          new Error('Failed request: [404] {"detail":"Not found."}'),
        );
      const client = makeClient(fetch);

      await expect(client.getSignalReport("abc")).resolves.toBeNull();
    });

    it("returns null when the shared fetcher throws a 403", async () => {
      const fetch = vi
        .fn()
        .mockRejectedValue(
          new Error('Failed request: [403] {"detail":"Forbidden."}'),
        );
      const client = makeClient(fetch);

      await expect(client.getSignalReport("abc")).resolves.toBeNull();
    });

    it("rethrows non-404/403 errors", async () => {
      const fetch = vi
        .fn()
        .mockRejectedValue(new Error("Failed request: [500] boom"));
      const client = makeClient(fetch);

      await expect(client.getSignalReport("abc")).rejects.toThrow("[500]");
    });
  });

  describe("getTaskSummaries", () => {
    const SUMMARIES_PATH = "/api/projects/123/tasks/summaries/";

    function buildClient(fetch: ReturnType<typeof vi.fn>) {
      const client = new PostHogAPIClient(
        "http://localhost:8000",
        async () => "token",
        async () => "token",
        123,
      );
      (
        client as unknown as {
          api: { baseUrl: string; fetcher: { fetch: typeof fetch } };
        }
      ).api = { baseUrl: "http://localhost:8000", fetcher: { fetch } };
      return client;
    }

    function page(results: object[], next: string | null = null) {
      return {
        ok: true,
        json: async () => ({ count: 0, previous: null, next, results }),
      };
    }

    function buildFetchForPages(...pages: ReturnType<typeof page>[]) {
      const fetch = vi.fn();
      for (const p of pages) fetch.mockResolvedValueOnce(p);
      return fetch;
    }

    it("returns immediately for empty input without hitting the network", async () => {
      const fetch = vi.fn();
      await expect(buildClient(fetch).getTaskSummaries([])).resolves.toEqual(
        [],
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it("returns single-page results without further requests", async () => {
      const fetch = buildFetchForPages(page([{ id: "a" }]));
      await expect(buildClient(fetch).getTaskSummaries(["a"])).resolves.toEqual(
        [{ id: "a" }],
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
      {
        name: "same-host next URL",
        nextUrl: `http://localhost:8000${SUMMARIES_PATH}?limit=2&offset=2`,
        expectedSecondPath: `${SUMMARIES_PATH}?limit=2&offset=2`,
      },
      {
        name: "cross-host next URL (proxy variance)",
        nextUrl: `https://internal.posthog.example${SUMMARIES_PATH}?limit=1&offset=1`,
        expectedSecondPath: `${SUMMARIES_PATH}?limit=1&offset=1`,
      },
    ])(
      "follows the next cursor across pages and merges results: $name",
      async ({ nextUrl, expectedSecondPath }) => {
        const fetch = buildFetchForPages(
          page([{ id: "a" }, { id: "b" }], nextUrl),
          page([{ id: "c" }]),
        );
        await expect(
          buildClient(fetch).getTaskSummaries(["a", "b", "c"]),
        ).resolves.toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls[0][0]).toMatchObject({
          method: "post",
          path: SUMMARIES_PATH,
        });
        expect(fetch.mock.calls[1][0]).toMatchObject({
          method: "post",
          path: expectedSecondPath,
        });
      },
    );

    it("throws when the server responds non-OK", async () => {
      const fetch = vi
        .fn()
        .mockResolvedValue({ ok: false, statusText: "Bad Request" });
      await expect(buildClient(fetch).getTaskSummaries(["a"])).rejects.toThrow(
        "Bad Request",
      );
    });

    it("returns partial results when MAX_PAGES is exceeded", async () => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          page(
            [{ id: "x" }],
            `http://localhost:8000${SUMMARIES_PATH}?offset=1`,
          ),
        );
      const result = await buildClient(fetch).getTaskSummaries(["a"]);
      expect(fetch).toHaveBeenCalledTimes(50);
      expect(result.length).toBe(50);
    });
  });

  describe("getSignalReportArtefacts", () => {
    function makeClient(fetch: ReturnType<typeof vi.fn>) {
      const client = new PostHogAPIClient(
        "http://localhost:8000",
        async () => "token",
        async () => "token",
        123,
      );
      (
        client as unknown as {
          api: { baseUrl: string; fetcher: { fetch: typeof fetch } };
        }
      ).api = {
        baseUrl: "http://localhost:8000",
        fetcher: { fetch },
      };
      return client;
    }

    // One row per backend ArtefactType (products/signals/backend/models.py),
    // content shapes mirroring artefact_schemas.py / real API payloads.
    const ROWS = [
      {
        id: "a1",
        type: "video_segment",
        content: {
          session_id: "s1",
          start_time: "2026-06-01T00:00:00Z",
          end_time: "2026-06-01T00:01:00Z",
          distinct_id: "d1",
          content: "user rage-clicked the save button",
          distance_to_centroid: 0.1,
        },
        created_at: "2026-06-01T00:00:00Z",
      },
      {
        id: "a2",
        type: "safety_judgment",
        content: { choice: true, explanation: "No prompt injection found." },
        created_at: "2026-06-01T00:00:01Z",
        task_id: "t1",
      },
      {
        id: "a3",
        type: "actionability_judgment",
        content: {
          explanation: "Clear repro and code path.",
          actionability: "immediately_actionable",
          already_addressed: false,
        },
        created_at: "2026-06-01T00:00:02Z",
      },
      {
        id: "a4",
        type: "priority_judgment",
        content: { explanation: "Cosmetic race.", priority: "P3" },
        created_at: "2026-06-01T00:00:03Z",
      },
      {
        id: "a5",
        type: "signal_finding",
        content: {
          signal_id: "sig-1",
          relevant_code_paths: ["a.ts"],
          relevant_commit_hashes: { abc1234: "introduced the bug" },
          data_queried: "execute-sql",
          verified: true,
        },
        created_at: "2026-06-01T00:00:04Z",
      },
      {
        id: "a6",
        type: "repo_selection",
        content: { repository: "posthog/posthog", reason: "Caller provided." },
        created_at: "2026-06-01T00:00:05Z",
      },
      {
        id: "a7",
        type: "suggested_reviewers",
        content: [
          {
            github_login: "octocat",
            github_name: "Octo Cat",
            relevant_commits: [],
            user: null,
          },
        ],
        created_at: "2026-06-01T00:00:06Z",
      },
      {
        id: "a8",
        type: "dismissal",
        content: {
          reason: "already_fixed",
          note: "",
          user_id: 1,
          user_uuid: null,
        },
        created_at: "2026-06-01T00:00:07Z",
      },
      {
        id: "a9",
        type: "code_reference",
        content: {
          file_path: "src/a.ts",
          start_line: 1,
          end_line: 3,
          contents: "let x = 1",
          relevance_note: "origin",
        },
        created_at: "2026-06-01T00:00:08Z",
      },
      {
        id: "a11",
        type: "line_reference",
        content: {
          file_path: "src/a.ts",
          line: 2,
          note: "here",
          contents: "x++",
        },
        created_at: "2026-06-01T00:00:10Z",
      },
      {
        id: "a12",
        type: "commit",
        content: {
          repository: "posthog/posthog",
          branch: "main",
          commit_sha: "abc1234",
          message: "fix",
          note: null,
        },
        created_at: "2026-06-01T00:00:11Z",
      },
      {
        id: "a13",
        type: "task_run",
        content: { task_id: "t1", product: "tasks", type: "agent_run" },
        created_at: "2026-06-01T00:00:12Z",
        task_id: "t1",
      },
      {
        id: "a14",
        type: "note",
        content: { note: "Guinea-pig probe note." },
        created_at: "2026-06-01T00:00:13Z",
        task_id: "t1",
        created_by: null,
      },
    ];

    it("normalizes every backend artefact type without dropping rows", async () => {
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ count: ROWS.length, results: ROWS }),
      });
      const client = makeClient(fetch);

      const { results, unavailableReason } =
        await client.getSignalReportArtefacts("r1");

      expect(unavailableReason).toBeUndefined();
      expect(results.map((a) => a.id)).toEqual(ROWS.map((r) => r.id));
      expect(results.map((a) => a.type)).toEqual(ROWS.map((r) => r.type));
      expect(results.every((a) => !a.degraded)).toBe(true);
    });

    it("keeps rows whose content does not match the type's shape as degraded previews", async () => {
      const rows = [
        // commit missing branch/sha — must not vanish
        {
          id: "bad1",
          type: "commit",
          content: { repository: "posthog/posthog", message: "where am I" },
          created_at: "2026-06-01T00:00:00Z",
          task_id: "t1",
        },
        // unknown future type with arbitrary object content
        {
          id: "bad2",
          type: "deploy_event",
          content: { reason: "rolled back v2" },
          created_at: "2026-06-01T00:00:01Z",
        },
        // empty content
        {
          id: "bad3",
          type: "note",
          content: {},
          created_at: "2026-06-01T00:00:02Z",
        },
      ];
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ count: rows.length, results: rows }),
      });
      const client = makeClient(fetch);

      const { results } = await client.getSignalReportArtefacts("r1");

      expect(results.map((a) => a.id)).toEqual(["bad1", "bad2", "bad3"]);
      expect(results.every((a) => a.degraded)).toBe(true);
      expect(results[0].type).toBe("commit");
      expect((results[1].content as { content: string }).content).toBe(
        "rolled back v2",
      );
      // attribution survives the fallback path
      expect(results[0].task_id).toBe("t1");
    });
  });

  describe("updateSignalReportArtefact", () => {
    const ARTEFACT_PATH =
      "/api/projects/123/signals/reports/report-1/artefacts/art-1/";

    function makeClient(fetch: ReturnType<typeof vi.fn>) {
      const client = new PostHogAPIClient(
        "http://localhost:8000",
        async () => "token",
        async () => "token",
        123,
      );
      (
        client as unknown as {
          api: { baseUrl: string; fetcher: { fetch: typeof fetch } };
        }
      ).api = { baseUrl: "http://localhost:8000", fetcher: { fetch } };
      return client;
    }

    const OCTOCAT_REVIEWER = {
      github_login: "octocat",
      github_name: "The Octocat",
      relevant_commits: [],
      user: null,
    };

    it.each([
      {
        name: "PUTs the full-replacement content and returns the parsed artefact",
        input: [{ github_login: "octocat" }, { user_uuid: "uuid-1" }],
        responseContent: [OCTOCAT_REVIEWER],
      },
      {
        name: "sends an empty content array when clearing reviewers",
        input: [],
        responseContent: [],
      },
    ])("$name", async ({ input, responseContent }) => {
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "art-1",
          type: "suggested_reviewers",
          created_at: "2024-01-01T00:00:00Z",
          content: responseContent,
        }),
      });
      const client = makeClient(fetch);

      const result = await client.updateSignalReportArtefact(
        "report-1",
        "art-1",
        input,
      );

      expect(result.type).toBe("suggested_reviewers");
      expect(result.content).toEqual(responseContent);
      expect(fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "put",
          path: ARTEFACT_PATH,
          overrides: { body: JSON.stringify({ content: input }) },
        }),
      );
    });

    it("throws with the server message on a non-ok response", async () => {
      const fetch = vi.fn().mockResolvedValue({
        ok: false,
        text: async () =>
          '{"error":"Only suggested_reviewers artefacts may be modified via this endpoint."}',
      });
      const client = makeClient(fetch);

      await expect(
        client.updateSignalReportArtefact("report-1", "art-1", []),
      ).rejects.toThrow("Only suggested_reviewers");
    });

    it("throws when the response is not a suggested_reviewers artefact", async () => {
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "art-1",
          type: "dismissal",
          created_at: "2024-01-01T00:00:00Z",
          content: { reason: "noise", note: "" },
        }),
      });
      const client = makeClient(fetch);

      await expect(
        client.updateSignalReportArtefact("report-1", "art-1", []),
      ).rejects.toThrow("Unexpected response");
    });
  });
});
