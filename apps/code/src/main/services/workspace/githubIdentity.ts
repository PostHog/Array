import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../../utils/logger";

const log = logger.scope("workspace-github-identity");

const execFileAsync = promisify(execFile);

export interface GitHubUserInfo {
  id: number;
  login: string;
  name?: string | null;
  email?: string | null;
}

export interface WorktreeIdentity {
  name: string;
  email: string;
}

/**
 * Resolve a `<id>+<login>@users.noreply.github.com` identity for the user,
 * but only when GitHub reports their email as private. When the user has a
 * public email there is no GH007 push rejection to avoid, so we leave the
 * worktree using whatever email the user has configured.
 */
export function computeNoreplyIdentity(
  user: GitHubUserInfo,
): WorktreeIdentity | null {
  if (!user.id || !user.login) return null;
  if (user.email) return null;
  return {
    name: user.name?.trim() || user.login,
    email: `${user.id}+${user.login}@users.noreply.github.com`,
  };
}

export interface FetchGitHubUserInfoOptions {
  /** Override for tests; defaults to invoking the local `gh` CLI. */
  runGh?: (args: string[]) => Promise<string>;
}

const GH_API_TIMEOUT_MS = 5_000;

async function defaultRunGh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, {
    timeout: GH_API_TIMEOUT_MS,
  });
  return stdout;
}

/**
 * Fetch the authenticated GitHub user via the user's `gh` CLI. Returns null
 * if `gh` is not installed, not authenticated, or returns an unexpected
 * shape — pre-configuring the noreply is a best-effort optimization and
 * must not fail workspace creation.
 */
export async function fetchGitHubUserInfo(
  options: FetchGitHubUserInfoOptions = {},
): Promise<GitHubUserInfo | null> {
  const runGh = options.runGh ?? defaultRunGh;
  let stdout: string;
  try {
    stdout = await runGh(["api", "user"]);
  } catch (error) {
    log.debug("gh api user failed; skipping noreply pre-configuration", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    if (typeof parsed.id !== "number" || typeof parsed.login !== "string") {
      return null;
    }
    return {
      id: parsed.id,
      login: parsed.login,
      name: typeof parsed.name === "string" ? parsed.name : null,
      email: typeof parsed.email === "string" ? parsed.email : null,
    };
  } catch {
    return null;
  }
}

/**
 * Set `user.name` and `user.email` on a worktree without affecting the main
 * repo. Uses `git config --worktree`, which requires the repo extension
 * `extensions.worktreeConfig` to be enabled — we toggle it here. The flag
 * is purely an opt-in to per-worktree config storage and has no effect on
 * any existing setting.
 */
export async function applyWorktreeIdentity(
  worktreePath: string,
  identity: WorktreeIdentity,
): Promise<void> {
  await execFileAsync(
    "git",
    ["config", "--local", "extensions.worktreeConfig", "true"],
    { cwd: worktreePath },
  );
  await execFileAsync(
    "git",
    ["config", "--worktree", "user.email", identity.email],
    { cwd: worktreePath },
  );
  await execFileAsync(
    "git",
    ["config", "--worktree", "user.name", identity.name],
    { cwd: worktreePath },
  );
}
