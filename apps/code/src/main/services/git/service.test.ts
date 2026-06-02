import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecGh = vi.hoisted(() => vi.fn());
const mockGetRemoteUrl = vi.hoisted(() => vi.fn());

vi.mock("@posthog/git/gh", () => ({
  execGh: mockExecGh,
}));

vi.mock("@posthog/git/queries", async () => {
  const actual = await vi.importActual<object>("@posthog/git/queries");
  return { ...actual, getRemoteUrl: mockGetRemoteUrl };
});

vi.mock("../../utils/logger.js", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import type { IWorkspaceRepository } from "../../db/repositories/workspace-repository";
import type { AgentService } from "../agent/service";
import type { LlmGatewayService } from "../llm-gateway/service";
import type { WorkspaceService } from "../workspace/service";
import { GitService, mapPrState } from "./service";

const stubWorkspaceRepo = {} as IWorkspaceRepository;

describe("GitService.getPrChangedFiles", () => {
  let service: GitService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitService(
      {} as LlmGatewayService,
      {} as WorkspaceService,
      { getSessionEnvForTask: async () => ({}) } as unknown as AgentService,
      stubWorkspaceRepo,
    );
  });

  it("flattens paginated GH API results and maps file statuses", async () => {
    mockExecGh.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify([
        [
          {
            filename: "src/new.ts",
            status: "added",
            additions: 10,
            deletions: 0,
          },
          {
            filename: "src/old.ts",
            status: "removed",
            additions: 0,
            deletions: 3,
          },
        ],
        [
          {
            filename: "src/renamed-new.ts",
            status: "renamed",
            previous_filename: "src/renamed-old.ts",
            additions: 1,
            deletions: 1,
          },
          {
            filename: "src/changed.ts",
            status: "changed",
            additions: 4,
            deletions: 2,
          },
        ],
      ]),
    });

    const result = await service.getPrChangedFiles(
      "https://github.com/posthog/code/pull/123",
    );

    expect(mockExecGh).toHaveBeenCalledWith([
      "api",
      "repos/posthog/code/pulls/123/files",
      "--paginate",
      "--slurp",
    ]);

    expect(result).toEqual([
      {
        path: "src/new.ts",
        status: "added",
        originalPath: undefined,
        linesAdded: 10,
        linesRemoved: 0,
      },
      {
        path: "src/old.ts",
        status: "deleted",
        originalPath: undefined,
        linesAdded: 0,
        linesRemoved: 3,
      },
      {
        path: "src/renamed-new.ts",
        status: "renamed",
        originalPath: "src/renamed-old.ts",
        linesAdded: 1,
        linesRemoved: 1,
      },
      {
        path: "src/changed.ts",
        status: "modified",
        originalPath: undefined,
        linesAdded: 4,
        linesRemoved: 2,
      },
    ]);
  });

  it("returns empty array for non-GitHub PR URL", async () => {
    const result = await service.getPrChangedFiles(
      "https://example.com/pull/1",
    );
    expect(result).toEqual([]);
    expect(mockExecGh).not.toHaveBeenCalled();
  });

  it("throws when gh command fails", async () => {
    mockExecGh.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "auth required",
    });

    await expect(
      service.getPrChangedFiles("https://github.com/posthog/code/pull/123"),
    ).rejects.toThrow("Failed to fetch PR files");
  });
});

describe("GitService.getGhAuthToken", () => {
  let service: GitService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitService(
      {} as LlmGatewayService,
      {} as WorkspaceService,
      { getSessionEnvForTask: async () => ({}) } as unknown as AgentService,
      stubWorkspaceRepo,
    );
  });

  it("returns the authenticated GitHub CLI token", async () => {
    mockExecGh.mockResolvedValue({
      exitCode: 0,
      stdout: "ghu_test_token\n",
      stderr: "",
    });

    const result = await service.getGhAuthToken();

    expect(mockExecGh).toHaveBeenCalledWith(["auth", "token"]);
    expect(result).toEqual({
      success: true,
      token: "ghu_test_token",
      error: null,
    });
  });

  it("returns the gh error when auth token lookup fails", async () => {
    mockExecGh.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "authentication required",
    });

    const result = await service.getGhAuthToken();

    expect(result).toEqual({
      success: false,
      token: null,
      error: "authentication required",
    });
  });

  it("returns error when stdout is empty", async () => {
    mockExecGh.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });

    const result = await service.getGhAuthToken();

    expect(result).toEqual({
      success: false,
      token: null,
      error: "GitHub auth token is empty",
    });
  });
});

describe("GitService.getPrUrlForBranch", () => {
  let service: GitService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitService(
      {} as LlmGatewayService,
      {} as WorkspaceService,
      { getSessionEnvForTask: async () => ({}) } as unknown as AgentService,
      stubWorkspaceRepo,
    );
  });

  it("returns the PR URL for a branch via gh pr list", async () => {
    mockGetRemoteUrl.mockResolvedValue("https://github.com/posthog/code.git");
    mockExecGh.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify([
        { url: "https://github.com/posthog/code/pull/42" },
      ]),
    });

    const result = await service.getPrUrlForBranch("/repo", "feat/x");

    expect(mockExecGh).toHaveBeenCalledWith([
      "pr",
      "list",
      "--head",
      "feat/x",
      "--state",
      "all",
      "--json",
      "url",
      "--limit",
      "1",
      "--repo",
      "posthog/code",
    ]);
    expect(result).toBe("https://github.com/posthog/code/pull/42");
  });

  it("returns null when no PR exists for the branch", async () => {
    mockGetRemoteUrl.mockResolvedValue("https://github.com/posthog/code.git");
    mockExecGh.mockResolvedValue({ exitCode: 0, stdout: "[]" });

    const result = await service.getPrUrlForBranch("/repo", "feat/no-pr");

    expect(result).toBeNull();
  });

  it("returns null for a non-GitHub remote", async () => {
    mockGetRemoteUrl.mockResolvedValue("https://gitlab.com/foo/bar.git");

    const result = await service.getPrUrlForBranch("/repo", "feat/x");

    expect(result).toBeNull();
    expect(mockExecGh).not.toHaveBeenCalled();
  });

  it("returns null when the repo has no remote", async () => {
    mockGetRemoteUrl.mockResolvedValue(null);

    const result = await service.getPrUrlForBranch("/repo", "feat/x");

    expect(result).toBeNull();
    expect(mockExecGh).not.toHaveBeenCalled();
  });

  it("returns null when gh command fails", async () => {
    mockGetRemoteUrl.mockResolvedValue("https://github.com/posthog/code.git");
    mockExecGh.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "auth required",
    });

    const result = await service.getPrUrlForBranch("/repo", "feat/x");

    expect(result).toBeNull();
  });
});

describe("mapPrState", () => {
  it("returns merged when merged boolean is true", () => {
    expect(mapPrState("open", true, false)).toBe("merged");
    expect(mapPrState("closed", true, false)).toBe("merged");
    expect(mapPrState(null, true, false)).toBe("merged");
  });

  it("returns merged when state string is MERGED", () => {
    expect(mapPrState("MERGED", false, false)).toBe("merged");
    expect(mapPrState("merged", false, false)).toBe("merged");
    expect(mapPrState("Merged", false, false)).toBe("merged");
  });

  it("returns closed for closed state", () => {
    expect(mapPrState("closed", false, false)).toBe("closed");
    expect(mapPrState("CLOSED", false, false)).toBe("closed");
  });

  it("returns draft when draft is true and not merged/closed", () => {
    expect(mapPrState("open", false, true)).toBe("draft");
  });

  it("closed takes priority over draft", () => {
    expect(mapPrState("closed", false, true)).toBe("closed");
  });

  it("returns open for open state", () => {
    expect(mapPrState("open", false, false)).toBe("open");
    expect(mapPrState("OPEN", false, false)).toBe("open");
  });

  it("returns null for unknown state", () => {
    expect(mapPrState(null, false, false)).toBeNull();
    expect(mapPrState("something", false, false)).toBeNull();
  });
});

describe("GitService.getPrReviewComments", () => {
  let service: GitService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitService(
      {} as LlmGatewayService,
      {} as WorkspaceService,
      { getSessionEnvForTask: async () => ({}) } as unknown as AgentService,
      stubWorkspaceRepo,
    );
  });

  const makeThread = (id: string, commentId: number) => ({
    id,
    isResolved: false,
    isOutdated: false,
    path: "src/foo.ts",
    diffSide: "RIGHT",
    line: 10,
    originalLine: 10,
    startLine: null,
    startDiffSide: null,
    subjectType: "LINE",
    comments: {
      nodes: [
        {
          databaseId: commentId,
          body: "looks good",
          path: "src/foo.ts",
          diffHunk: "@@ -1,3 +1,4 @@",
          replyTo: null,
          author: {
            login: "alice",
            avatarUrl: "https://example.com/alice.png",
          },
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ],
    },
  });

  const makePage = (
    threads: object[],
    hasNextPage: boolean,
    endCursor: string | null,
  ) => ({
    exitCode: 0,
    stdout: JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage, endCursor },
              nodes: threads,
            },
          },
        },
      },
    }),
  });

  it("returns empty array for non-PR URL", async () => {
    const result = await service.getPrReviewComments(
      "https://github.com/owner/repo",
    );
    expect(result).toEqual([]);
    expect(mockExecGh).not.toHaveBeenCalled();
  });

  it("maps a single-page response to PrReviewThread[]", async () => {
    mockExecGh.mockResolvedValueOnce(
      makePage([makeThread("T_1", 101)], false, null),
    );

    const result = await service.getPrReviewComments(
      "https://github.com/owner/repo/pull/1",
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      nodeId: "T_1",
      isResolved: false,
      rootId: 101,
      filePath: "src/foo.ts",
    });
    expect(result[0].comments[0]).toMatchObject({
      id: 101,
      body: "looks good",
      side: "RIGHT",
      line: 10,
      subject_type: "line",
    });
  });

  it("fetches all pages when hasNextPage is true", async () => {
    mockExecGh
      .mockResolvedValueOnce(
        makePage([makeThread("T_1", 101)], true, "cursor-abc"),
      )
      .mockResolvedValueOnce(makePage([makeThread("T_2", 102)], false, null));

    const result = await service.getPrReviewComments(
      "https://github.com/owner/repo/pull/1",
    );

    expect(mockExecGh).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.nodeId)).toEqual(["T_1", "T_2"]);

    const secondCall = JSON.parse(mockExecGh.mock.calls[1][1].input);
    expect(secondCall.variables.cursor).toBe("cursor-abc");
  });

  it("returns partial results when MAX_THREAD_PAGES is exceeded", async () => {
    let n = 0;
    mockExecGh.mockImplementation(async () => {
      n += 1;
      return makePage([makeThread(`T_${n}`, 100 + n)], true, `cursor-${n}`);
    });

    const result = await service.getPrReviewComments(
      "https://github.com/owner/repo/pull/1",
    );

    expect(mockExecGh).toHaveBeenCalledTimes(50);
    expect(result).toHaveLength(50);
    expect(result[0]?.nodeId).toBe("T_1");
    expect(result[49]?.nodeId).toBe("T_50");
  });

  it("throws when gh exits with non-zero", async () => {
    mockExecGh.mockResolvedValueOnce({
      exitCode: 1,
      stderr: "auth error",
      stdout: "",
    });

    await expect(
      service.getPrReviewComments("https://github.com/owner/repo/pull/1"),
    ).rejects.toThrow("Failed to fetch PR review threads");
  });

  it("throws with the GraphQL error message when GitHub returns 200 with errors", async () => {
    mockExecGh.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({
        data: null,
        errors: [{ message: "Resource not accessible by integration" }],
      }),
    });

    await expect(
      service.getPrReviewComments("https://github.com/owner/repo/pull/1"),
    ).rejects.toThrow("Resource not accessible by integration");
  });
});

describe("GitService.resolveReviewThread", () => {
  let service: GitService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitService(
      {} as LlmGatewayService,
      {} as WorkspaceService,
      { getSessionEnvForTask: async () => ({}) } as unknown as AgentService,
      stubWorkspaceRepo,
    );
  });

  it("resolves a thread and returns isResolved: true", async () => {
    mockExecGh.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({
        data: {
          resolveReviewThread: { thread: { id: "T_1", isResolved: true } },
        },
      }),
    });

    const result = await service.resolveReviewThread("T_1", true);

    expect(result).toEqual({ success: true, isResolved: true });
    const body = JSON.parse(mockExecGh.mock.calls[0][1].input);
    expect(body.query).toContain("resolveReviewThread");
    expect(body.variables.threadId).toBe("T_1");
  });

  it("unresolves a thread and returns isResolved: false", async () => {
    mockExecGh.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({
        data: {
          unresolveReviewThread: { thread: { id: "T_1", isResolved: false } },
        },
      }),
    });

    const result = await service.resolveReviewThread("T_1", false);

    expect(result).toEqual({ success: true, isResolved: false });
    const body = JSON.parse(mockExecGh.mock.calls[0][1].input);
    expect(body.query).toContain("unresolveReviewThread");
  });

  it("returns success: false when gh exits with non-zero", async () => {
    mockExecGh.mockResolvedValueOnce({
      exitCode: 1,
      stderr: "network error",
      stdout: "",
    });

    const result = await service.resolveReviewThread("T_1", true);

    expect(result).toEqual({ success: false, isResolved: false });
  });
});
