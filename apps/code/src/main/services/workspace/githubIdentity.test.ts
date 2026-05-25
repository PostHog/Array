import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { makeLoggerMock } from "@test/loggerMock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger.js", () => makeLoggerMock());

import {
  applyWorktreeIdentity,
  computeNoreplyIdentity,
  fetchGitHubUserInfo,
} from "./githubIdentity";

const execFileAsync = promisify(execFile);

describe("computeNoreplyIdentity", () => {
  it("returns noreply identity when GitHub user has email privacy enabled", () => {
    expect(
      computeNoreplyIdentity({
        id: 12345,
        login: "octocat",
        name: "Octo Cat",
        email: null,
      }),
    ).toEqual({
      name: "Octo Cat",
      email: "12345+octocat@users.noreply.github.com",
    });
  });

  it("falls back to login when name is missing", () => {
    expect(
      computeNoreplyIdentity({ id: 12345, login: "octocat", email: null }),
    ).toEqual({
      name: "octocat",
      email: "12345+octocat@users.noreply.github.com",
    });
  });

  it("returns null when GitHub user has a public email", () => {
    expect(
      computeNoreplyIdentity({
        id: 12345,
        login: "octocat",
        email: "octo@example.com",
      }),
    ).toBeNull();
  });

  it("returns null when id or login is missing", () => {
    expect(
      computeNoreplyIdentity({
        id: 0,
        login: "octocat",
        email: null,
      }),
    ).toBeNull();
    expect(
      computeNoreplyIdentity({
        id: 12345,
        login: "",
        email: null,
      }),
    ).toBeNull();
  });
});

describe("fetchGitHubUserInfo", () => {
  it("returns parsed user info when gh api user succeeds", async () => {
    const runGh = vi
      .fn()
      .mockResolvedValue(
        '{"id":12345,"login":"octocat","name":"Octo Cat","email":null}',
      );
    const result = await fetchGitHubUserInfo({ runGh });
    expect(result).toEqual({
      id: 12345,
      login: "octocat",
      name: "Octo Cat",
      email: null,
    });
    expect(runGh).toHaveBeenCalledWith(["api", "user"]);
  });

  it("returns null when gh fails (not installed / not authenticated)", async () => {
    const runGh = vi.fn().mockRejectedValue(new Error("gh: command not found"));
    expect(await fetchGitHubUserInfo({ runGh })).toBeNull();
  });

  it("returns null when response is malformed JSON", async () => {
    const runGh = vi.fn().mockResolvedValue("not json");
    expect(await fetchGitHubUserInfo({ runGh })).toBeNull();
  });

  it("returns null when required fields are missing", async () => {
    const runGh = vi.fn().mockResolvedValue('{"login":"octocat"}');
    expect(await fetchGitHubUserInfo({ runGh })).toBeNull();
  });
});

describe("applyWorktreeIdentity (integration)", () => {
  let mainRepo: string;
  let worktreePath: string;

  beforeEach(async () => {
    mainRepo = await fs.mkdtemp(path.join(os.tmpdir(), "posthog-id-main-"));
    await execFileAsync("git", ["init", "-q"], { cwd: mainRepo });
    await execFileAsync(
      "git",
      ["config", "user.email", "private@example.com"],
      { cwd: mainRepo },
    );
    await execFileAsync("git", ["config", "user.name", "Real Name"], {
      cwd: mainRepo,
    });
    await execFileAsync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: mainRepo,
    });

    const worktreeBase = await fs.mkdtemp(
      path.join(os.tmpdir(), "posthog-id-wt-"),
    );
    worktreePath = path.join(worktreeBase, "wt");
    await execFileAsync("git", ["worktree", "add", "--detach", worktreePath], {
      cwd: mainRepo,
    });
  });

  afterEach(async () => {
    await fs.rm(mainRepo, { recursive: true, force: true });
    await fs.rm(path.dirname(worktreePath), { recursive: true, force: true });
  });

  it("sets user.email and user.name only in the worktree, not the main repo", async () => {
    await applyWorktreeIdentity(worktreePath, {
      name: "Octo Cat",
      email: "12345+octocat@users.noreply.github.com",
    });

    const { stdout: worktreeEmail } = await execFileAsync(
      "git",
      ["config", "user.email"],
      { cwd: worktreePath },
    );
    expect(worktreeEmail.trim()).toBe("12345+octocat@users.noreply.github.com");

    const { stdout: worktreeName } = await execFileAsync(
      "git",
      ["config", "user.name"],
      { cwd: worktreePath },
    );
    expect(worktreeName.trim()).toBe("Octo Cat");

    // Main repo must retain its original identity.
    const { stdout: mainEmail } = await execFileAsync(
      "git",
      ["config", "--local", "user.email"],
      { cwd: mainRepo },
    );
    expect(mainEmail.trim()).toBe("private@example.com");
    const { stdout: mainName } = await execFileAsync(
      "git",
      ["config", "--local", "user.name"],
      { cwd: mainRepo },
    );
    expect(mainName.trim()).toBe("Real Name");
  });
});
