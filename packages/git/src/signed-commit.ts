// Namespace import (not `{ execFile }`) so the renderer's browser bundle can
// resolve this node-only module against vite's `__vite-browser-external` stub,
// which has no named exports. This module never runs in the browser.
import * as childProcess from "node:child_process";
import { mapWithConcurrency } from "./concurrency";
import { execGh, execGhWithRetry } from "./gh";
import { buildPostHogTrailers } from "./trailers";
import { parseGithubUrl } from "./utils";

/**
 * Creates GitHub-signed ("Verified") commits without any local signing key, by
 * sending the staged changes through GitHub's GraphQL `createCommitOnBranch`
 * mutation. The mutation authors and signs the commit as the identity that owns
 * the token, so cloud-agent commits satisfy signed-commit branch protection.
 *
 * This is the deterministic replacement for the prompt-driven `gh api graphql`
 * flow: it passes the `FileChanges` payload as a real GraphQL object (not a
 * string scalar), fetches the branch tip so multi-commit diffs work, chunks
 * oversized payloads, and keeps the local checkout pointed at the new commit.
 */

const DEFAULT_MAX_PAYLOAD_BYTES = 35 * 1024 * 1024;
const MAX_GIT_BUFFER = 256 * 1024 * 1024;
// Per-attempt cap for the GraphQL commit call; retried with backoff on timeout.
const GH_GRAPHQL_TIMEOUT_MS = 30_000;

export interface SignedCommitCtx {
  /** Working directory of the clone. */
  cwd: string;
  /** GitHub token used for the mutation; determines the signed author identity. */
  token: string;
  /** Appended as a `Task-Id` trailer when present. */
  taskId?: string;
  /**
   * Branch the tool refuses to commit directly onto. Defaults to the remote's
   * default branch (`origin/HEAD`), so an accidental commit straight onto `main`
   * is blocked even without an explicit value.
   */
  baseBranch?: string;
}

export interface SignedCommitInput {
  /** Commit headline (first line). */
  message: string;
  /** Optional extended body; PostHog trailers are appended automatically. */
  body?: string;
  /** Target branch; defaults to the current branch. Created on the remote if missing. */
  branch?: string;
  /** Files to stage before committing; defaults to whatever is already staged. */
  paths?: string[];
}

export interface SignedCommitResult {
  branch: string;
  /** One entry per chunk; >1 only when the payload was split. */
  commits: { sha: string; url: string }[];
}

export class OversizedFileError extends Error {
  constructor(
    readonly path: string,
    readonly bytes: number,
    readonly maxBytes: number,
  ) {
    super(
      `File '${path}' (~${Math.round(bytes / 1024 / 1024)}MB once base64-encoded) ` +
        `exceeds the per-commit request limit (~${Math.round(maxBytes / 1024 / 1024)}MB). ` +
        `A single file cannot be split across createCommitOnBranch requests; use Git LFS ` +
        `or a local signing key for this change.`,
    );
    this.name = "OversizedFileError";
  }
}

interface FileAddition {
  path: string;
  contents: string;
}
interface FileDeletion {
  path: string;
}
interface FileChanges {
  additions: FileAddition[];
  deletions: FileDeletion[];
}

interface GitRunResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
}

function runGit(args: string[], cwd: string): Promise<GitRunResult> {
  return new Promise((resolve) => {
    childProcess.execFile(
      "git",
      args,
      { cwd, maxBuffer: MAX_GIT_BUFFER, encoding: "buffer" },
      (error, stdout, stderr) => {
        const err = error as (Error & { code?: number | string }) | null;
        const exitCode =
          err && typeof err.code === "number" ? err.code : err ? 1 : 0;
        resolve({
          stdout: (stdout as unknown as Buffer) ?? Buffer.alloc(0),
          stderr: ((stderr as unknown as Buffer) ?? Buffer.alloc(0)).toString(
            "utf8",
          ),
          exitCode,
        });
      },
    );
  });
}

async function gitText(args: string[], cwd: string): Promise<string> {
  const r = await runGit(args, cwd);
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  }
  return r.stdout.toString("utf8").trim();
}

async function resolveRepoNameWithOwner(ctx: SignedCommitCtx): Promise<string> {
  const url = await gitText(["remote", "get-url", "origin"], ctx.cwd);
  const parsed = parseGithubUrl(url);
  if (!parsed) {
    throw new Error(`Could not parse owner/repo from origin remote: ${url}`);
  }
  return `${parsed.owner}/${parsed.repo}`;
}

async function resolveBaseBranch(ctx: SignedCommitCtx): Promise<string | null> {
  if (ctx.baseBranch) return ctx.baseBranch;
  // Fall back to the remote's default branch so the guard still fires when no
  // explicit base is supplied. Best-effort: a clone without origin/HEAD just
  // leaves the guard inactive rather than failing the commit.
  const r = await runGit(
    ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    ctx.cwd,
  );
  if (r.exitCode !== 0) return null;
  return (
    r.stdout
      .toString("utf8")
      .trim()
      .replace(/^origin\//, "") || null
  );
}

async function resolveBranchName(
  ctx: SignedCommitCtx,
  input: SignedCommitInput,
): Promise<string> {
  const branch = input.branch
    ? input.branch.replace(/^refs\/heads\//, "")
    : await resolveCurrentBranch(ctx);

  // Guard both paths: an explicit `branch: "main"` must be refused the same as
  // landing on the base branch implicitly via HEAD.
  const baseBranch = await resolveBaseBranch(ctx);
  if (baseBranch && branch === baseBranch) {
    throw new Error(
      `Refusing to commit directly to base branch '${baseBranch}'. ` +
        `Pass a 'branch' name prefixed with posthog-code/.`,
    );
  }
  return branch;
}

async function resolveCurrentBranch(ctx: SignedCommitCtx): Promise<string> {
  const current = await gitText(["rev-parse", "--abbrev-ref", "HEAD"], ctx.cwd);
  if (!current || current === "HEAD") {
    throw new Error(
      "Detached HEAD — pass a `branch` to git_signed_commit (e.g. posthog-code/...).",
    );
  }
  return current;
}

async function remoteTip(
  ctx: SignedCommitCtx,
  branch: string,
): Promise<string | null> {
  const out = await gitText(
    ["ls-remote", "--heads", "origin", branch],
    ctx.cwd,
  );
  if (!out) return null;
  return out.split("\t")[0]?.trim() || null;
}

async function createRef(
  ctx: SignedCommitCtx,
  repo: string,
  branch: string,
  sha: string,
): Promise<void> {
  const res = await execGh(
    [
      "api",
      "-X",
      "POST",
      `/repos/${repo}/git/refs`,
      "-f",
      `ref=refs/heads/${branch}`,
      "-f",
      `sha=${sha}`,
    ],
    { cwd: ctx.cwd, env: ghTokenEnv(ctx.token) },
  );
  if (res.exitCode !== 0) {
    throw new Error(
      `Failed to create branch '${branch}': ${res.stderr || res.error}`,
    );
  }
}

/** Env var names the GitHub CLI / git credential helper read a token from, in order. */
export const GITHUB_TOKEN_ENV_VARS = ["GH_TOKEN", "GITHUB_TOKEN"] as const;

/** First GitHub token found in `env` (defaults to the process env), if any. */
export function readGithubTokenFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  for (const name of GITHUB_TOKEN_ENV_VARS) {
    if (env[name]) return env[name];
  }
  return undefined;
}

export function ghTokenEnv(token: string): Record<string, string> {
  return Object.fromEntries(GITHUB_TOKEN_ENV_VARS.map((name) => [name, token]));
}

// Concurrency for staged-blob reads; bounds spawned `git show` processes while
// still cutting wall-clock for multi-file commits.
const STAGED_READ_CONCURRENCY = 16;

async function buildFileChanges(
  ctx: SignedCommitCtx,
  baseOid: string,
): Promise<FileChanges> {
  // One `--name-status -z` diff yields additions and deletions together; output
  // is `<status>\0<path>\0...` (no rename pairs, since `--no-renames`). Read raw
  // (no trim) so paths with leading/trailing spaces survive.
  const diff = await runGit(
    ["diff", "--cached", "-z", "--no-renames", "--name-status", baseOid],
    ctx.cwd,
  );
  if (diff.exitCode !== 0) {
    throw new Error(`git diff --cached failed: ${diff.stderr.trim()}`);
  }
  const tokens = diff.stdout.toString("utf8").split("\0").filter(Boolean);

  const addPaths: string[] = [];
  const deletions: FileDeletion[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const path = tokens[i + 1];
    if (tokens[i].startsWith("D")) {
      deletions.push({ path });
    } else {
      addPaths.push(path);
    }
  }

  const additions = await mapWithConcurrency(
    addPaths,
    STAGED_READ_CONCURRENCY,
    async (path) => {
      // Read the *staged* blob (`:path`) so we commit exactly what was staged,
      // not any later unstaged edits in the working tree.
      const r = await runGit(["show", `:${path}`], ctx.cwd);
      if (r.exitCode !== 0) {
        throw new Error(
          `Failed to read staged file '${path}': ${r.stderr.trim()}`,
        );
      }
      return { path, contents: r.stdout.toString("base64") };
    },
  );
  return { additions, deletions };
}

function additionBytes(a: FileAddition): number {
  // base64 contents dominate; add path + per-entry JSON envelope overhead.
  return a.contents.length + a.path.length + 32;
}

export function chunkFileChanges(
  changes: FileChanges,
  maxBytes: number,
): FileChanges[] {
  for (const a of changes.additions) {
    const bytes = additionBytes(a);
    if (bytes > maxBytes) throw new OversizedFileError(a.path, bytes, maxBytes);
  }

  if (changes.additions.length === 0) {
    return [{ additions: [], deletions: changes.deletions }];
  }

  const chunks: FileChanges[] = [];
  // Deletions are path-only (negligible); put them all in the first chunk.
  let cur: FileChanges = { additions: [], deletions: [...changes.deletions] };
  let curBytes = changes.deletions.reduce((n, d) => n + d.path.length + 16, 0);

  for (const a of changes.additions) {
    const bytes = additionBytes(a);
    if (cur.additions.length > 0 && curBytes + bytes > maxBytes) {
      chunks.push(cur);
      cur = { additions: [], deletions: [] };
      curBytes = 0;
    }
    cur.additions.push(a);
    curBytes += bytes;
  }
  chunks.push(cur);
  return chunks;
}

const CREATE_COMMIT_MUTATION = `mutation($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) { commit { oid url } }
}`;

async function createCommitOnBranch(
  ctx: SignedCommitCtx,
  repo: string,
  branch: string,
  expectedHeadOid: string,
  headline: string,
  body: string,
  changes: FileChanges,
): Promise<{ oid: string; url: string }> {
  const payload = JSON.stringify({
    query: CREATE_COMMIT_MUTATION,
    variables: {
      input: {
        branch: { repositoryNameWithOwner: repo, branchName: branch },
        expectedHeadOid,
        message: { headline, body },
        fileChanges: changes,
      },
    },
  });

  const res = await execGhWithRetry(
    ["api", "graphql", "--input", "-"],
    {
      cwd: ctx.cwd,
      input: payload,
      env: ghTokenEnv(ctx.token),
      // Bound each attempt so a stalled connection can't hang the tool forever.
      timeoutMs: GH_GRAPHQL_TIMEOUT_MS,
    },
    { maxAttempts: 3 },
  );
  if (res.exitCode !== 0) {
    throw new Error(
      `createCommitOnBranch failed: ${res.stderr || res.error || res.stdout}`,
    );
  }

  let parsed: {
    data?: { createCommitOnBranch?: { commit?: { oid: string; url: string } } };
    errors?: unknown;
  };
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    throw new Error(
      `createCommitOnBranch returned non-JSON: ${res.stdout.slice(0, 500)}`,
    );
  }
  if (parsed.errors) {
    throw new Error(
      `createCommitOnBranch errors: ${JSON.stringify(parsed.errors)}`,
    );
  }
  const commit = parsed.data?.createCommitOnBranch?.commit;
  if (!commit?.oid) {
    throw new Error(`createCommitOnBranch returned no commit: ${res.stdout}`);
  }
  return commit;
}

async function syncLocalCheckout(
  ctx: SignedCommitCtx,
  branch: string,
  newOid: string,
): Promise<void> {
  // Fetch the new tip object, point the local branch + HEAD at it, and reset
  // the index — all without touching the working tree, so unstaged work the
  // agent intends for a later commit is preserved. Best-effort: the commit is
  // already on the remote, and the next call re-resolves the tip via ls-remote,
  // so a sync failure isn't fatal — but warn rather than swallow it silently,
  // since a stale local checkout is otherwise painful to diagnose.
  const steps: [string, string[]][] = [
    ["fetch", ["fetch", "--no-tags", "origin", branch]],
    ["update-ref", ["update-ref", `refs/heads/${branch}`, newOid]],
    ["symbolic-ref", ["symbolic-ref", "HEAD", `refs/heads/${branch}`]],
    ["reset", ["reset", "-q"]],
  ];
  for (const [label, args] of steps) {
    const r = await runGit(args, ctx.cwd);
    if (r.exitCode !== 0) {
      process.stderr.write(
        `[signed-commit] local sync step '${label}' failed after committing ${newOid}: ${r.stderr.trim()}\n`,
      );
    }
  }
}

export async function createSignedCommit(
  ctx: SignedCommitCtx,
  input: SignedCommitInput,
): Promise<SignedCommitResult> {
  // Repo (from origin remote) and branch (from HEAD) are independent reads.
  const [repo, branch] = await Promise.all([
    resolveRepoNameWithOwner(ctx),
    resolveBranchName(ctx, input),
  ]);

  if (input.paths && input.paths.length > 0) {
    const r = await runGit(["add", "--", ...input.paths], ctx.cwd);
    if (r.exitCode !== 0) {
      throw new Error(`git add failed: ${r.stderr.trim()}`);
    }
  }

  let tip = await remoteTip(ctx, branch);
  if (tip === null) {
    // New branch: create it from the local HEAD, which is already present —
    // no fetch needed to diff against it.
    const baseSha = await gitText(["rev-parse", "HEAD"], ctx.cwd);
    await createRef(ctx, repo, branch, baseSha);
    tip = baseSha;
  } else {
    // Existing branch: make its tip object local so the staged diff (and any
    // later reset) can resolve it.
    await runGit(["fetch", "--no-tags", "origin", branch], ctx.cwd);
  }

  const changes = await buildFileChanges(ctx, tip);
  if (changes.additions.length === 0 && changes.deletions.length === 0) {
    throw new Error(
      "No staged changes to commit. Stage files with `git add` first (or pass `paths`).",
    );
  }

  const chunks = chunkFileChanges(changes, DEFAULT_MAX_PAYLOAD_BYTES);
  const body = [input.body, buildPostHogTrailers(ctx.taskId).join("\n")]
    .filter(Boolean)
    .join("\n\n");

  const commits: { sha: string; url: string }[] = [];
  let expectedHeadOid = tip;
  for (let i = 0; i < chunks.length; i++) {
    const headline =
      chunks.length > 1
        ? `${input.message} — part ${i + 1}/${chunks.length}`
        : input.message;
    const commit = await createCommitOnBranch(
      ctx,
      repo,
      branch,
      expectedHeadOid,
      headline,
      body,
      chunks[i],
    );
    commits.push({ sha: commit.oid, url: commit.url });
    expectedHeadOid = commit.oid;
  }

  await syncLocalCheckout(ctx, branch, expectedHeadOid);
  return { branch, commits };
}
