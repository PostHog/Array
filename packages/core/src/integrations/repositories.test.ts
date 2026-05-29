import { describe, expect, it } from "vitest";
import {
  combineGithubRepositories,
  combineRepositoryPicker,
  combineUserGithubRepositories,
  getIntegrationIdForRepo,
  isRepoInIntegration,
  normalizeRepoKey,
  type RepositoryQueryResult,
  type TeamRepositoriesResult,
  type UserRepositoriesResult,
  type UserRepositoryIntegrationRef,
} from "./repositories";

function result<T>(
  data: T | undefined,
  flags: Partial<Omit<RepositoryQueryResult<T>, "data">> = {},
): RepositoryQueryResult<T> {
  return {
    data,
    isPending: flags.isPending ?? false,
    isError: flags.isError ?? false,
    isRefetching: flags.isRefetching ?? false,
  };
}

describe("combineGithubRepositories", () => {
  it("builds a repo->integration map and keeps the first integration to claim a repo", () => {
    const results: RepositoryQueryResult<TeamRepositoriesResult>[] = [
      result({ integrationId: 1, repos: ["a/x", "a/y"] }),
      result({ integrationId: 2, repos: ["a/x", "a/z"] }),
    ];

    const combined = combineGithubRepositories(results);

    expect(combined.repositoryMap).toEqual({
      "a/x": 1,
      "a/y": 1,
      "a/z": 2,
    });
    expect(combined.isPending).toBe(false);
  });

  it("reports pending when any result is pending", () => {
    const combined = combineGithubRepositories([
      result<TeamRepositoriesResult>(undefined, { isPending: true }),
    ]);
    expect(combined.isPending).toBe(true);
  });
});

describe("combineUserGithubRepositories", () => {
  it("tracks reposByInstallationId and tallies failed installation ids", () => {
    const results: RepositoryQueryResult<UserRepositoriesResult>[] = [
      result({
        userIntegrationId: "u1",
        installationId: "i1",
        repos: ["a/x"],
      }),
      result<UserRepositoriesResult>(undefined, { isError: true }),
    ];

    const combined = combineUserGithubRepositories(results, ["i1", "i2"]);

    expect(combined.repositoryMap["a/x"]).toEqual({
      userIntegrationId: "u1",
      installationId: "i1",
    });
    expect(combined.reposByInstallationId).toEqual({ i1: ["a/x"] });
    expect(combined.failedInstallationIds).toEqual(["i2"]);
  });
});

describe("combineRepositoryPicker", () => {
  it("merges pages, derives hasMore/isRefreshing/isPending", () => {
    const combined = combineRepositoryPicker<UserRepositoryIntegrationRef>([
      {
        data: {
          ref: { userIntegrationId: "u1", installationId: "i1" },
          repositories: ["a/x"],
          hasMore: true,
        },
        isPending: false,
        isError: false,
        isRefetching: true,
      },
    ]);

    expect(Object.keys(combined.repositoryMap)).toEqual(["a/x"]);
    expect(combined.hasMore).toBe(true);
    expect(combined.isRefreshing).toBe(true);
  });
});

describe("repo key helpers", () => {
  it("normalizes case", () => {
    expect(normalizeRepoKey("Acme/Repo")).toBe("acme/repo");
  });

  it("looks up integration id case-insensitively", () => {
    expect(getIntegrationIdForRepo({ "a/x": 5 }, "A/X")).toBe(5);
  });

  it("treats empty repo key as in-integration", () => {
    expect(isRepoInIntegration({}, "")).toBe(true);
    expect(isRepoInIntegration({ "a/x": 1 }, "A/X")).toBe(true);
    expect(isRepoInIntegration({}, "a/x")).toBe(false);
  });
});
