//! GitHub-signed commits without a local signing key.
//!
//! Port of `@posthog/git/signed-commit.ts`: staged changes are sent through
//! GitHub's GraphQL `createCommitOnBranch` mutation, which authors and signs
//! the commit as the token's identity, so cloud-agent commits satisfy
//! signed-commit branch protection.
//!
//! The guards (mid-operation refusal, behind-remote refusal, base-leak
//! detection) and every agent-facing error message are behavioral contracts
//! with the model prompt — keep them byte-compatible with the TS
//! implementation when editing either side.

use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, bail, Result};
use base64::Engine as _;
use futures::stream::{StreamExt, TryStreamExt};
use serde_json::{json, Value};

use crate::gh::{exec_gh, exec_gh_with_retry, GhOptions, GhResult};

const DEFAULT_MAX_PAYLOAD_BYTES: usize = 35 * 1024 * 1024;
// Per-attempt cap for the GraphQL commit call; retried with backoff on timeout.
const GH_GRAPHQL_TIMEOUT: Duration = Duration::from_secs(30);
// Concurrency for staged-blob reads; bounds spawned `git show` processes while
// still cutting wall-clock for multi-file commits.
const STAGED_READ_CONCURRENCY: usize = 16;

#[derive(Debug, Clone)]
pub struct SignedCommitCtx {
    /// Working directory of the clone.
    pub cwd: PathBuf,
    /// GitHub token used for the mutation; determines the signed author identity.
    pub token: String,
    /// Appended as a `Task-Id` trailer when present.
    pub task_id: Option<String>,
    /// Branch the tool refuses to commit directly onto. Defaults to the
    /// remote's default branch (`origin/HEAD`), so an accidental commit
    /// straight onto `main` is blocked even without an explicit value.
    pub base_branch: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct SignedCommitInput {
    /// Commit headline (first line).
    pub message: String,
    /// Optional extended body; PostHog trailers are appended automatically.
    pub body: Option<String>,
    /// Target branch; defaults to the current branch. Created on the remote if missing.
    pub branch: Option<String>,
    /// Files to stage before committing; defaults to whatever is already staged.
    pub paths: Option<Vec<String>>,
}

#[derive(Debug, Clone)]
pub struct CommitRef {
    pub sha: String,
    pub url: String,
}

#[derive(Debug, Clone)]
pub struct SignedCommitResult {
    pub branch: String,
    /// Repository the commits were pushed to, as `owner/repo` (from the origin remote).
    pub repository: String,
    /// One entry per chunk; >1 only when the payload was split.
    pub commits: Vec<CommitRef>,
}

#[derive(Debug, Clone, Default)]
pub struct SignedRewriteInput {
    pub branch: Option<String>,
    pub onto: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct SignedMergeInput {
    /// PR branch to update; defaults to the current branch.
    pub branch: Option<String>,
    /// Branch (or sha) to merge in; defaults to the detected base branch.
    pub base: Option<String>,
}

#[derive(Debug, Clone)]
pub enum SignedMergeResult {
    /// The branch already contained the base (HTTP 204).
    UpToDate { branch: String, base: String },
    Merged {
        branch: String,
        base: String,
        commit: CommitRef,
        /// Set when the remote merge succeeded but the local checkout could not be synced.
        local_sync_warning: Option<String>,
    },
}

// ---------------------------------------------------------------------------
// Trailers (@posthog/git/trailers.ts)

pub fn build_posthog_trailers(task_id: Option<&str>) -> Vec<String> {
    let mut trailers = vec!["Generated-By: PostHog Code".to_string()];
    if let Some(task_id) = task_id {
        trailers.push(format!("Task-Id: {task_id}"));
    }
    trailers
}

// ---------------------------------------------------------------------------
// GitHub token resolution (utils/github-token.ts)

/// agentsh env file (NUL-delimited `key=value` pairs) that the PostHog backend
/// rewrites in place when it refreshes the sandbox's GitHub credentials
/// mid-session. The driver's process env is frozen at launch, so reading this
/// live file is how in-process tools pick up a refreshed token without a
/// process restart.
pub const SANDBOX_ENV_FILE: &str = "/tmp/agent-env";

/// Env var names the GitHub CLI / git credential helper read a token from, in order.
pub const GITHUB_TOKEN_ENV_VARS: [&str; 2] = ["GH_TOKEN", "GITHUB_TOKEN"];

pub fn parse_nul_delimited_env(raw: &str) -> HashMap<String, String> {
    let mut env = HashMap::new();
    for entry in raw.split('\0') {
        if let Some(eq) = entry.find('=') {
            if eq > 0 {
                env.insert(entry[..eq].to_string(), entry[eq + 1..].to_string());
            }
        }
    }
    env
}

pub fn read_github_token_from_sandbox_env_file(env_file_path: &str) -> Option<String> {
    let raw = std::fs::read_to_string(env_file_path).ok()?;
    let env = parse_nul_delimited_env(&raw);
    GITHUB_TOKEN_ENV_VARS
        .iter()
        .find_map(|name| env.get(*name).filter(|v| !v.is_empty()).cloned())
}

/// The GitHub token available to the sandbox, if any. Prefers the live agentsh
/// env file (refreshed in place mid-session) over the process env (frozen at
/// launch) so long-running in-process tools pick up a refreshed token without
/// a restart.
pub fn resolve_github_token(env_file_path: &str) -> Option<String> {
    read_github_token_from_sandbox_env_file(env_file_path).or_else(|| {
        GITHUB_TOKEN_ENV_VARS
            .iter()
            .find_map(|name| std::env::var(name).ok().filter(|v| !v.is_empty()))
    })
}

// ---------------------------------------------------------------------------
// Git plumbing helpers

#[derive(Debug)]
struct GitRun {
    stdout: Vec<u8>,
    stderr: String,
    exit_code: i32,
}

async fn run_git<S: AsRef<OsStr>>(args: &[S], cwd: &Path) -> GitRun {
    let output = tokio::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .kill_on_drop(true)
        .output()
        .await;
    match output {
        Ok(output) => GitRun {
            stdout: output.stdout,
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(1),
        },
        Err(err) => GitRun {
            stdout: Vec::new(),
            stderr: format!("failed to spawn git: {err}"),
            exit_code: 127,
        },
    }
}

async fn git_text<S: AsRef<OsStr>>(args: &[S], cwd: &Path) -> Result<String> {
    let r = run_git(args, cwd).await;
    if r.exit_code != 0 {
        let joined = args
            .iter()
            .map(|a| a.as_ref().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(" ");
        bail!("git {joined} failed: {}", r.stderr.trim());
    }
    Ok(String::from_utf8_lossy(&r.stdout).trim().to_string())
}

// ---------------------------------------------------------------------------
// Mid-operation guard

/// Conflicted/multi-parent git operation that may be mid-flight in a checkout.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitOperationInProgress {
    Merge,
    Rebase,
    CherryPick,
}

const OPERATION_MARKERS: [(&str, GitOperationInProgress); 4] = [
    ("MERGE_HEAD", GitOperationInProgress::Merge),
    ("CHERRY_PICK_HEAD", GitOperationInProgress::CherryPick),
    ("rebase-merge", GitOperationInProgress::Rebase),
    ("rebase-apply", GitOperationInProgress::Rebase),
];

async fn detect_operation_in_progress(cwd: &Path) -> Result<Option<GitOperationInProgress>> {
    // `--git-path` resolves the marker locations correctly inside worktrees,
    // returning paths relative to the process cwd.
    let mut args: Vec<&str> = vec!["rev-parse"];
    for (marker, _) in &OPERATION_MARKERS {
        args.push("--git-path");
        args.push(marker);
    }
    let out = git_text(&args, cwd).await?;
    let marker_paths: Vec<&str> = out.split('\n').collect();
    for (i, (_, op)) in OPERATION_MARKERS.iter().enumerate() {
        if let Some(marker_path) = marker_paths.get(i) {
            if !marker_path.is_empty() && cwd.join(marker_path).exists() {
                return Ok(Some(*op));
            }
        }
    }
    Ok(None)
}

/// Agent-facing refusal for publishing while a git operation is mid-flight.
pub fn operation_in_progress_error(op: GitOperationInProgress) -> String {
    match op {
        GitOperationInProgress::Merge => {
            "A merge is in progress (MERGE_HEAD exists). Commits are published via GitHub's \
             createCommitOnBranch API, which can only create single-parent commits — committing \
             a staged merge would LINEARIZE it, attributing every base-branch change since the \
             branch point to this PR (this is how PRs balloon to 100k+ changed lines). \
             Recovery: run `git merge --abort`, then either call `git_signed_merge` to merge the \
             base branch server-side (clean merges), or run `git rebase origin/<base>`, resolve \
             conflicts, finish with `git rebase --continue`, and call `git_signed_rewrite`."
                .to_string()
        }
        GitOperationInProgress::Rebase => {
            "A rebase is in progress. Finish it first — resolve conflicts, `git add` the files, \
             then `git rebase --continue` (or back out with `git rebase --abort`) — and publish \
             the rebased branch with `git_signed_rewrite`."
                .to_string()
        }
        GitOperationInProgress::CherryPick => {
            "A cherry-pick is in progress. Finish it first with `git cherry-pick --continue` \
             (or back out with `git cherry-pick --abort`), then retry."
                .to_string()
        }
    }
}

// ---------------------------------------------------------------------------
// Repo / branch resolution

/// Extracts `owner/repo` from a GitHub remote URL. Covers the URL forms git
/// actually writes for origin remotes (HTTPS with optional basic auth, SCP-ish
/// SSH, ssh:// URLs); rejects non-GitHub hosts like the TS `parseGithubUrl`.
pub fn parse_github_owner_repo(url: &str) -> Option<(String, String)> {
    let url = url.trim();
    let rest = if let Some(rest) = url.strip_prefix("https://").or(url.strip_prefix("http://")) {
        // Strip userinfo (`x-access-token:ghs_...@github.com/...`).
        let rest = rest.rsplit_once('@').map(|(_, r)| r).unwrap_or(rest);
        rest.replace(':', "/")
    } else if let Some(rest) = url.strip_prefix("ssh://") {
        let rest = rest.rsplit_once('@').map(|(_, r)| r).unwrap_or(rest);
        rest.replace(':', "/")
    } else if let Some((_, rest)) = url.split_once('@') {
        // SCP syntax: git@github.com:owner/repo.git
        rest.replace(':', "/")
    } else {
        url.replace(':', "/")
    };

    let mut parts = rest.split('/').filter(|p| !p.is_empty());
    let host = parts.next()?.to_lowercase();
    if host != "github.com" && host != "ssh.github.com" {
        return None;
    }
    let owner = parts.next()?;
    let repo = parts.next()?.trim_end_matches(".git");
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((owner.to_string(), repo.to_string()))
}

async fn resolve_repo_name_with_owner(ctx: &SignedCommitCtx) -> Result<String> {
    let url = git_text(&["remote", "get-url", "origin"], &ctx.cwd).await?;
    let (owner, repo) = parse_github_owner_repo(&url)
        .ok_or_else(|| anyhow!("Could not parse owner/repo from origin remote: {url}"))?;
    Ok(format!("{owner}/{repo}"))
}

async fn resolve_base_branch(ctx: &SignedCommitCtx) -> Option<String> {
    if let Some(base) = &ctx.base_branch {
        return Some(base.clone());
    }
    // Fall back to the remote's default branch so the guard still fires when no
    // explicit base is supplied. Best-effort: a clone without origin/HEAD just
    // leaves the guard inactive rather than failing the commit.
    let r = run_git(
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
        &ctx.cwd,
    )
    .await;
    if r.exit_code != 0 {
        return None;
    }
    let name = String::from_utf8_lossy(&r.stdout).trim().to_string();
    let name = name.strip_prefix("origin/").unwrap_or(&name).to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

async fn resolve_current_branch(ctx: &SignedCommitCtx) -> Result<String> {
    let current = git_text(&["rev-parse", "--abbrev-ref", "HEAD"], &ctx.cwd).await?;
    if current.is_empty() || current == "HEAD" {
        bail!("Detached HEAD — pass a `branch` to git_signed_commit (e.g. posthog-code/...).");
    }
    Ok(current)
}

async fn resolve_branch_name(ctx: &SignedCommitCtx, branch: Option<&str>) -> Result<String> {
    let branch = match branch {
        Some(branch) => branch
            .strip_prefix("refs/heads/")
            .unwrap_or(branch)
            .to_string(),
        None => resolve_current_branch(ctx).await?,
    };
    // Guard both paths: an explicit `branch: "main"` must be refused the same
    // as landing on the base branch implicitly via HEAD.
    if let Some(base_branch) = resolve_base_branch(ctx).await {
        if branch == base_branch {
            bail!(
                "Refusing to commit directly to base branch '{base_branch}'. \
                 Pass a 'branch' name prefixed with posthog-code/."
            );
        }
    }
    Ok(branch)
}

async fn remote_tip(ctx: &SignedCommitCtx, branch: &str) -> Result<Option<String>> {
    let out = git_text(&["ls-remote", "--heads", "origin", branch], &ctx.cwd).await?;
    if out.is_empty() {
        return Ok(None);
    }
    let tip = out.split('\t').next().unwrap_or("").trim().to_string();
    Ok(if tip.is_empty() { None } else { Some(tip) })
}

// ---------------------------------------------------------------------------
// Behind-remote guard

/// Agent-facing refusal when the remote branch has advanced past the local checkout.
pub fn behind_remote_error(branch: &str, tip: &str) -> String {
    let short_tip: String = tip.chars().take(12).collect();
    format!(
        "Refusing to commit: remote branch '{branch}' has advanced past your local checkout \
         (remote tip {short_tip} is not in your local history). Something pushed to the branch \
         after your last commit — often CI automation that auto-commits regenerated artifacts \
         (codegen, lockfiles, formatting) onto open PRs, or another collaborator. Committing now \
         would build the new commit on the remote tip while taking file contents from your stale \
         tree, silently REVERTING those commits. Recovery (preserves your uncommitted work): \
         `git stash --include-untracked`, then `git fetch origin {branch}` and \
         `git reset --hard origin/{branch}`, then `git stash pop` — resolve any pop conflicts, \
         as they mark real overlaps with the new commits — then re-stage and retry \
         git_signed_commit. The hard reset is safe here: your work is saved in the stash, and only \
         a hard reset pulls the new commits' files into your working tree (a soft/mixed reset would \
         keep your stale copies and re-commit the revert). If you were integrating the base branch, \
         use git_signed_merge / git_signed_rewrite instead."
    )
}

/// Refuse when the remote `tip` has commits the local checkout lacks: the
/// commit builds on `tip` but takes file contents from the index (based on
/// local HEAD), so the staged diff would re-express every remotely-changed
/// file as its stale local blob, silently reverting them. No-op on an unborn
/// HEAD or an unresolvable relationship, so a missing object never blocks a
/// real commit. Caller must have fetched `tip` first.
async fn assert_not_behind_remote(ctx: &SignedCommitCtx, branch: &str, tip: &str) -> Result<()> {
    let head = run_git(&["rev-parse", "HEAD"], &ctx.cwd).await;
    if head.exit_code != 0 {
        return Ok(());
    }
    if String::from_utf8_lossy(&head.stdout).trim() == tip {
        return Ok(());
    }
    // exit 1 ⇒ tip not reachable from HEAD ⇒ remote has commits we lack ⇒ refuse.
    let reachable = run_git(&["merge-base", "--is-ancestor", tip, "HEAD"], &ctx.cwd).await;
    if reachable.exit_code == 1 {
        bail!(behind_remote_error(branch, tip));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Ref API helpers (gh api REST)

fn gh_options(ctx: &SignedCommitCtx) -> GhOptions {
    GhOptions {
        cwd: Some(ctx.cwd.to_string_lossy().to_string()),
        token: Some(ctx.token.clone()),
        ..Default::default()
    }
}

async fn ref_api(ctx: &SignedCommitCtx, args: &[String], err_label: &str) -> Result<()> {
    let res = exec_gh(args, &gh_options(ctx)).await;
    if res.exit_code != 0 {
        let detail = if res.stderr.is_empty() {
            res.error.clone().unwrap_or_default()
        } else {
            res.stderr.clone()
        };
        bail!("{err_label}: {detail}");
    }
    Ok(())
}

async fn create_ref(ctx: &SignedCommitCtx, repo: &str, branch: &str, sha: &str) -> Result<()> {
    ref_api(
        ctx,
        &[
            "api".into(),
            "-X".into(),
            "POST".into(),
            format!("/repos/{repo}/git/refs"),
            "-f".into(),
            format!("ref=refs/heads/{branch}"),
            "-f".into(),
            format!("sha={sha}"),
        ],
        &format!("Failed to create branch '{branch}'"),
    )
    .await
}

/// Fast-forward-only ref update: GitHub rejects a non-fast-forward PATCH
/// without `force`, so a concurrently moved branch fails safely instead of
/// being clobbered.
async fn fast_forward_ref(
    ctx: &SignedCommitCtx,
    repo: &str,
    branch: &str,
    sha: &str,
) -> Result<()> {
    ref_api(
        ctx,
        &[
            "api".into(),
            "-X".into(),
            "PATCH".into(),
            format!("/repos/{repo}/git/refs/heads/{branch}"),
            "-f".into(),
            format!("sha={sha}"),
        ],
        &format!("Failed to fast-forward '{branch}'"),
    )
    .await
}

async fn force_update_ref(
    ctx: &SignedCommitCtx,
    repo: &str,
    branch: &str,
    sha: &str,
) -> Result<()> {
    ref_api(
        ctx,
        &[
            "api".into(),
            "-X".into(),
            "PATCH".into(),
            format!("/repos/{repo}/git/refs/heads/{branch}"),
            "-f".into(),
            format!("sha={sha}"),
            "-F".into(),
            "force=true".into(),
        ],
        &format!("Failed to force-update '{branch}'"),
    )
    .await
}

async fn delete_ref(ctx: &SignedCommitCtx, repo: &str, branch: &str) -> Result<()> {
    ref_api(
        ctx,
        &[
            "api".into(),
            "-X".into(),
            "DELETE".into(),
            format!("/repos/{repo}/git/refs/heads/{branch}"),
        ],
        &format!("Failed to delete ref '{branch}'"),
    )
    .await
}

// ---------------------------------------------------------------------------
// FileChanges payload

#[derive(Debug, Clone)]
pub struct FileAddition {
    pub path: String,
    /// base64 blob contents.
    pub contents: String,
}

#[derive(Debug, Clone, Default)]
pub struct FileChanges {
    pub additions: Vec<FileAddition>,
    pub deletions: Vec<String>,
}

impl FileChanges {
    fn is_empty(&self) -> bool {
        self.additions.is_empty() && self.deletions.is_empty()
    }

    fn to_graphql(&self) -> Value {
        json!({
            "additions": self.additions.iter().map(|a| json!({
                "path": a.path,
                "contents": a.contents,
            })).collect::<Vec<_>>(),
            "deletions": self.deletions.iter().map(|p| json!({ "path": p })).collect::<Vec<_>>(),
        })
    }
}

// Turns a `--name-status -z` diff into the `FileChanges` payload, reading each
// added/modified file's new blob via `read_blob`.
async fn read_changes_from_diff(
    ctx: &SignedCommitCtx,
    diff_args: &[String],
    read_blob: impl Fn(&str) -> Vec<String>,
) -> Result<FileChanges> {
    let diff = run_git(diff_args, &ctx.cwd).await;
    if diff.exit_code != 0 {
        bail!("git {} failed: {}", diff_args.join(" "), diff.stderr.trim());
    }
    let text = String::from_utf8_lossy(&diff.stdout).to_string();
    let tokens: Vec<&str> = text.split('\0').filter(|t| !t.is_empty()).collect();

    let mut add_paths: Vec<String> = Vec::new();
    let mut deletions: Vec<String> = Vec::new();
    let mut i = 0;
    while i + 1 < tokens.len() {
        let path = tokens[i + 1].to_string();
        if tokens[i].starts_with('D') {
            deletions.push(path);
        } else {
            add_paths.push(path);
        }
        i += 2;
    }

    let cwd = ctx.cwd.clone();
    let additions: Vec<FileAddition> = futures::stream::iter(add_paths.into_iter().map(|path| {
        let blob_args = read_blob(&path);
        let cwd = cwd.clone();
        async move {
            let r = run_git(&blob_args, &cwd).await;
            if r.exit_code != 0 {
                bail!("Failed to read file '{path}': {}", r.stderr.trim());
            }
            Ok(FileAddition {
                path,
                contents: base64::engine::general_purpose::STANDARD.encode(&r.stdout),
            })
        }
    }))
    .buffered(STAGED_READ_CONCURRENCY)
    .try_collect()
    .await?;

    Ok(FileChanges {
        additions,
        deletions,
    })
}

fn build_file_changes<'a>(
    ctx: &'a SignedCommitCtx,
    base_oid: &str,
) -> impl std::future::Future<Output = Result<FileChanges>> + 'a {
    // Read the *staged* blob (`:path`) so we commit exactly what was staged,
    // not any later unstaged edits in the working tree.
    let diff_args: Vec<String> = vec![
        "diff".into(),
        "--cached".into(),
        "-z".into(),
        "--no-renames".into(),
        "--name-status".into(),
        base_oid.into(),
    ];
    async move {
        read_changes_from_diff(ctx, &diff_args, |path| {
            vec!["show".into(), format!(":{path}")]
        })
        .await
    }
}

// The change between two arbitrary commits/trees, reading the new blob from
// the `to` side. Used by the rewrite path to replay one commit's net diff at a
// time.
async fn build_file_changes_between(
    ctx: &SignedCommitCtx,
    from_oid: &str,
    to_oid: &str,
) -> Result<FileChanges> {
    let diff_args: Vec<String> = vec![
        "diff".into(),
        "-z".into(),
        "--no-renames".into(),
        "--name-status".into(),
        from_oid.into(),
        to_oid.into(),
    ];
    let to_oid = to_oid.to_string();
    read_changes_from_diff(ctx, &diff_args, move |path| {
        vec!["show".into(), format!("{to_oid}:{path}")]
    })
    .await
}

fn addition_bytes(a: &FileAddition) -> usize {
    // base64 contents dominate; add path + per-entry JSON envelope overhead.
    a.contents.len() + a.path.len() + 32
}

fn oversized_file_error(path: &str, bytes: usize, max_bytes: usize) -> anyhow::Error {
    let mb = (bytes as f64 / 1024.0 / 1024.0).round() as u64;
    let max_mb = (max_bytes as f64 / 1024.0 / 1024.0).round() as u64;
    anyhow!(
        "File '{path}' (~{mb}MB once base64-encoded) exceeds the per-commit request limit \
         (~{max_mb}MB). A single file cannot be split across createCommitOnBranch requests; \
         use Git LFS or a local signing key for this change."
    )
}

pub fn chunk_file_changes(changes: FileChanges, max_bytes: usize) -> Result<Vec<FileChanges>> {
    for a in &changes.additions {
        let bytes = addition_bytes(a);
        if bytes > max_bytes {
            return Err(oversized_file_error(&a.path, bytes, max_bytes));
        }
    }

    if changes.additions.is_empty() {
        return Ok(vec![FileChanges {
            additions: Vec::new(),
            deletions: changes.deletions,
        }]);
    }

    let mut chunks: Vec<FileChanges> = Vec::new();
    // Deletions are path-only (negligible); put them all in the first chunk.
    let mut cur_bytes: usize = changes.deletions.iter().map(|d| d.len() + 16).sum();
    let mut cur = FileChanges {
        additions: Vec::new(),
        deletions: changes.deletions,
    };

    for a in changes.additions {
        let bytes = addition_bytes(&a);
        if !cur.additions.is_empty() && cur_bytes + bytes > max_bytes {
            chunks.push(std::mem::take(&mut cur));
            cur_bytes = 0;
        }
        cur.additions.push(a);
        cur_bytes += bytes;
    }
    chunks.push(cur);
    Ok(chunks)
}

// ---------------------------------------------------------------------------
// Base-leak guard

/// One entry of `git diff-index` / `git diff-tree` raw `-z` output.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawDiffEntry {
    pub path: String,
    pub old_oid: String,
    /// All-zeros for deletions (and for an unmerged/dirty index entry).
    pub new_oid: String,
    /// Status letter: A/M/D/T/U… (`--no-renames` rules out two-path R/C entries).
    pub status: String,
}

/// Parses raw `-z` diff output: `:<oldmode> <newmode> <oldoid> <newoid> <status>\0<path>\0…`
pub fn parse_raw_diff_z(text: &str) -> Vec<RawDiffEntry> {
    let tokens: Vec<&str> = text.split('\0').collect();
    let mut entries = Vec::new();
    let mut i = 0;
    while i + 1 < tokens.len() {
        let meta = tokens[i];
        if !meta.starts_with(':') {
            i += 2;
            continue;
        }
        let fields: Vec<&str> = meta[1..].split(' ').collect();
        if fields.len() >= 5 {
            entries.push(RawDiffEntry {
                path: tokens[i + 1].to_string(),
                old_oid: fields[2].to_string(),
                new_oid: fields[3].to_string(),
                status: fields[4].to_string(),
            });
        }
        i += 2;
    }
    entries
}

/// Staged files that would copy base-branch content into the PR: not part of
/// the PR's existing diff, and staged with exactly the blob the base tip has
/// (matching all-zero OIDs make a staged deletion of a base-deleted file a
/// leak too, while PR-authored deletions of base-untouched files pass).
pub fn detect_base_leaks(
    staged: &[RawDiffEntry],
    pr_files: &HashSet<String>,
    base_changed: &HashMap<String, String>,
) -> Vec<String> {
    staged
        .iter()
        .filter(|e| !pr_files.contains(&e.path) && base_changed.get(&e.path) == Some(&e.new_oid))
        .map(|e| e.path.clone())
        .collect()
}

const LEAK_SAMPLE_SIZE: usize = 10;

/// Hard gate against the mass-file-leak failure: a botched base-branch merge
/// staged for `git_signed_commit` attributes every base-side change to the PR.
/// Best-effort like `sync_local_checkout` — environments where the base can't
/// be resolved (no origin/HEAD, failed fetch, shallow history without a merge
/// base) skip the check with a warning rather than blocking the commit.
async fn assert_no_base_leak(ctx: &SignedCommitCtx, branch: &str, tip: &str) -> Result<()> {
    let skip = |reason: String| {
        eprintln!("[signed-commit] base-leak check skipped: {reason}");
    };

    let Some(base) = resolve_base_branch(ctx).await else {
        return Ok(());
    };
    if base == branch {
        return Ok(());
    }

    let fetched = run_git(&["fetch", "--no-tags", "origin", &base], &ctx.cwd).await;
    if fetched.exit_code != 0 {
        skip(format!(
            "fetch origin/{base} failed: {}",
            fetched.stderr.trim()
        ));
        return Ok(());
    }
    let base_tip_res = run_git(
        &[
            "rev-parse",
            &format!("refs/remotes/origin/{base}^{{commit}}"),
        ],
        &ctx.cwd,
    )
    .await;
    if base_tip_res.exit_code != 0 {
        skip(format!("could not resolve origin/{base}"));
        return Ok(());
    }
    let base_tip = String::from_utf8_lossy(&base_tip_res.stdout)
        .trim()
        .to_string();

    let merge_base_res = run_git(&["merge-base", &base_tip, tip], &ctx.cwd).await;
    if merge_base_res.exit_code != 0 {
        let short_tip: String = tip.chars().take(12).collect();
        skip(format!(
            "no merge base between origin/{base} and {short_tip} (shallow clone?)"
        ));
        return Ok(());
    }
    let merge_base = String::from_utf8_lossy(&merge_base_res.stdout)
        .trim()
        .to_string();
    if merge_base == base_tip {
        return Ok(()); // branch already contains the base tip
    }

    // Three metadata-only diffs (no content reads), so this stays fast even on
    // very large repos. Plumbing output uses full blob OIDs, safe to compare.
    let staged_args = ["diff-index", "--cached", "-z", "--no-renames", tip];
    let pr_args = [
        "diff-tree",
        "-r",
        "-z",
        "--name-only",
        "--no-renames",
        &merge_base,
        tip,
    ];
    let base_args = [
        "diff-tree",
        "-r",
        "-z",
        "--no-renames",
        &merge_base,
        &base_tip,
    ];
    let (staged_raw, pr_names, base_raw) = tokio::try_join!(
        git_text(&staged_args, &ctx.cwd),
        git_text(&pr_args, &ctx.cwd),
        git_text(&base_args, &ctx.cwd),
    )?;

    let pr_files: HashSet<String> = pr_names
        .split('\0')
        .filter(|p| !p.is_empty())
        .map(|p| p.to_string())
        .collect();
    let base_changed: HashMap<String, String> = parse_raw_diff_z(&base_raw)
        .into_iter()
        .map(|e| (e.path, e.new_oid))
        .collect();
    let leaks = detect_base_leaks(&parse_raw_diff_z(&staged_raw), &pr_files, &base_changed);
    if leaks.is_empty() {
        return Ok(());
    }

    let sample = leaks
        .iter()
        .take(LEAK_SAMPLE_SIZE)
        .cloned()
        .collect::<Vec<_>>()
        .join("\n  ");
    let more = if leaks.len() > LEAK_SAMPLE_SIZE {
        format!("\n  …and {} more", leaks.len() - LEAK_SAMPLE_SIZE)
    } else {
        String::new()
    };
    bail!(
        "Refusing to commit: {} staged file(s) exactly match origin/{base} \
         content but are not part of this PR's diff — committing them would copy \
         base-branch changes into the PR (the mass-file-leak failure). This usually means \
         a merge from the base branch was staged. Leaked files:\n  {sample}{more}\n\
         Recovery: unstage everything (`git reset`), restore base-owned files from the \
         branch tip (`git checkout <tip> -- <paths>`), re-stage only the files you actually \
         changed, and retry. To bring the base branch into the PR, call `git_signed_merge` \
         instead.",
        leaks.len()
    );
}

// ---------------------------------------------------------------------------
// createCommitOnBranch

const CREATE_COMMIT_MUTATION: &str = "mutation($input: CreateCommitOnBranchInput!) {\n  createCommitOnBranch(input: $input) { commit { oid url } }\n}";

async fn create_commit_on_branch(
    ctx: &SignedCommitCtx,
    repo: &str,
    branch: &str,
    expected_head_oid: &str,
    headline: &str,
    body: &str,
    changes: &FileChanges,
) -> Result<CommitRef> {
    let payload = json!({
        "query": CREATE_COMMIT_MUTATION,
        "variables": {
            "input": {
                "branch": { "repositoryNameWithOwner": repo, "branchName": branch },
                "expectedHeadOid": expected_head_oid,
                "message": { "headline": headline, "body": body },
                "fileChanges": changes.to_graphql(),
            },
        },
    })
    .to_string();

    let res = exec_gh_with_retry(
        &crate::gh::args(&["api", "graphql", "--input", "-"]),
        &GhOptions {
            input: Some(payload),
            // Bound each attempt so a stalled connection can't hang the tool forever.
            timeout: Some(GH_GRAPHQL_TIMEOUT),
            ..gh_options(ctx)
        },
    )
    .await;
    if res.exit_code != 0 {
        let detail = [
            res.stderr.as_str(),
            res.error.as_deref().unwrap_or(""),
            res.stdout.as_str(),
        ]
        .iter()
        .find(|s| !s.is_empty())
        .copied()
        .unwrap_or("");
        bail!("createCommitOnBranch failed: {detail}");
    }

    let parsed: Value = serde_json::from_str(&res.stdout).map_err(|_| {
        anyhow!(
            "createCommitOnBranch returned non-JSON: {}",
            res.stdout.chars().take(500).collect::<String>()
        )
    })?;
    if let Some(errors) = parsed.get("errors") {
        if !errors.is_null() {
            bail!("createCommitOnBranch errors: {errors}");
        }
    }
    let commit = parsed.pointer("/data/createCommitOnBranch/commit");
    let oid = commit
        .and_then(|c| c.get("oid"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if oid.is_empty() {
        bail!("createCommitOnBranch returned no commit: {}", res.stdout);
    }
    Ok(CommitRef {
        sha: oid.to_string(),
        url: commit
            .and_then(|c| c.get("url"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    })
}

async fn sync_local_checkout(ctx: &SignedCommitCtx, branch: &str, new_oid: &str) {
    // Fetch the new tip object, point the local branch + HEAD at it, and reset
    // the index — all without touching the working tree, so unstaged work the
    // agent intends for a later commit is preserved. Best-effort: the commit is
    // already on the remote, and the next call re-resolves the tip via
    // ls-remote, so a sync failure isn't fatal — but warn rather than swallow
    // it silently, since a stale local checkout is otherwise painful to
    // diagnose.
    let update_ref = format!("refs/heads/{branch}");
    let steps: [(&str, Vec<&str>); 4] = [
        ("fetch", vec!["fetch", "--no-tags", "origin", branch]),
        ("update-ref", vec!["update-ref", &update_ref, new_oid]),
        ("symbolic-ref", vec!["symbolic-ref", "HEAD", &update_ref]),
        ("reset", vec!["reset", "-q"]),
    ];
    for (label, args) in steps {
        let r = run_git(&args, &ctx.cwd).await;
        if r.exit_code != 0 {
            eprintln!(
                "[signed-commit] local sync step '{label}' failed after committing {new_oid}: {}",
                r.stderr.trim()
            );
        }
    }
}

async fn publish_chunks(
    ctx: &SignedCommitCtx,
    repo: &str,
    branch: &str,
    base_oid: &str,
    headline: &str,
    body: &str,
    chunks: Vec<FileChanges>,
) -> Result<(Vec<CommitRef>, String)> {
    let mut commits = Vec::new();
    let mut tip = base_oid.to_string();
    let total = chunks.len();
    for (i, chunk) in chunks.into_iter().enumerate() {
        let hl = if total > 1 {
            format!("{headline} — part {}/{}", i + 1, total)
        } else {
            headline.to_string()
        };
        let commit = create_commit_on_branch(ctx, repo, branch, &tip, &hl, body, &chunk).await?;
        tip = commit.sha.clone();
        commits.push(commit);
    }
    Ok((commits, tip))
}

async fn publish_changes(
    ctx: &SignedCommitCtx,
    repo: &str,
    branch: &str,
    base_oid: &str,
    headline: &str,
    body: &str,
    changes: FileChanges,
) -> Result<(Vec<CommitRef>, String)> {
    let chunks = chunk_file_changes(changes, DEFAULT_MAX_PAYLOAD_BYTES)?;
    publish_chunks(ctx, repo, branch, base_oid, headline, body, chunks).await
}

/// Like `publish_changes`, but a payload split across multiple commits is
/// published to a scratch ref first and the real branch only moves once all
/// chunks landed — a mid-flight failure can't leave partial "part i/n" commits
/// on the branch. Single-chunk commits keep the direct fast path.
async fn publish_changes_atomic(
    ctx: &SignedCommitCtx,
    repo: &str,
    branch: &str,
    base_oid: &str,
    headline: &str,
    body: &str,
    changes: FileChanges,
) -> Result<(Vec<CommitRef>, String)> {
    let chunks = chunk_file_changes(changes, DEFAULT_MAX_PAYLOAD_BYTES)?;
    if chunks.len() == 1 {
        return publish_chunks(ctx, repo, branch, base_oid, headline, body, chunks).await;
    }

    let scratch = format!("posthog-code/commit-tmp/{}", uuid::Uuid::new_v4());
    create_ref(ctx, repo, &scratch, base_oid).await?;
    let published: Result<(Vec<CommitRef>, String)> = async {
        let published =
            publish_chunks(ctx, repo, &scratch, base_oid, headline, body, chunks).await?;
        // The chunk chain grew from `base_oid` (the branch tip we read), so this
        // is a fast-forward; it fails safely if the branch moved meanwhile.
        fast_forward_ref(ctx, repo, branch, &published.1).await?;
        Ok(published)
    }
    .await;
    // The scratch ref is just bookkeeping; a delete failure is non-fatal.
    let _ = delete_ref(ctx, repo, &scratch).await;
    published
}

// ---------------------------------------------------------------------------
// git_signed_commit

pub async fn create_signed_commit(
    ctx: &SignedCommitCtx,
    input: &SignedCommitInput,
) -> Result<SignedCommitResult> {
    // Refuse before touching the index: a staged merge/rebase/cherry-pick must
    // never reach createCommitOnBranch, which would linearize it.
    if let Some(op) = detect_operation_in_progress(&ctx.cwd).await? {
        bail!(operation_in_progress_error(op));
    }

    // Repo (from origin remote) and branch (from HEAD) are independent reads.
    let (repo, branch) = tokio::try_join!(
        resolve_repo_name_with_owner(ctx),
        resolve_branch_name(ctx, input.branch.as_deref()),
    )?;

    if let Some(paths) = &input.paths {
        if !paths.is_empty() {
            let mut args: Vec<String> = vec!["add".into(), "--".into()];
            args.extend(paths.iter().cloned());
            let r = run_git(&args, &ctx.cwd).await;
            if r.exit_code != 0 {
                bail!("git add failed: {}", r.stderr.trim());
            }
        }
    }

    let tip = match remote_tip(ctx, &branch).await? {
        None => {
            // New branch: create it from the local HEAD, which is already
            // present — no fetch needed to diff against it.
            let base_sha = git_text(&["rev-parse", "HEAD"], &ctx.cwd).await?;
            create_ref(ctx, &repo, &branch, &base_sha).await?;
            base_sha
        }
        Some(tip) => {
            // Existing branch: make its tip object local so the staged diff
            // (and any later reset) can resolve it.
            run_git(&["fetch", "--no-tags", "origin", &branch], &ctx.cwd).await;
            // Committing a stale tree onto an advanced tip would silently
            // revert the commits we never pulled.
            assert_not_behind_remote(ctx, &branch, &tip).await?;
            tip
        }
    };

    let changes = build_file_changes(ctx, &tip).await?;
    if changes.is_empty() {
        // The staged tree already equals the branch tip. If the index differs from HEAD there ARE
        // staged changes — they're just already present on `branch` — so this is an idempotent
        // no-op, not a "forgot to stage" error. Returning success stops the caller from retrying
        // `git add` against a branch that already has the content.
        let has_staged_changes = run_git(&["diff", "--cached", "--quiet", "HEAD"], &ctx.cwd)
            .await
            .exit_code
            != 0;
        if has_staged_changes {
            return Ok(SignedCommitResult {
                branch,
                repository: repo,
                commits: Vec::new(),
            });
        }
        bail!("No staged changes to commit. Stage files with `git add` first (or pass `paths`).");
    }

    assert_no_base_leak(ctx, &branch, &tip).await?;

    let trailers = build_posthog_trailers(ctx.task_id.as_deref()).join("\n");
    let body = match input.body.as_deref().filter(|b| !b.is_empty()) {
        Some(body) => format!("{body}\n\n{trailers}"),
        None => trailers,
    };

    let (commits, new_tip) =
        publish_changes_atomic(ctx, &repo, &branch, &tip, &input.message, &body, changes).await?;

    sync_local_checkout(ctx, &branch, &new_tip).await;
    Ok(SignedCommitResult {
        branch,
        repository: repo,
        commits,
    })
}

// ---------------------------------------------------------------------------
// git_signed_rewrite

/// Splits a raw commit message into a headline and the remaining body.
pub fn split_commit_message(raw: &str) -> (String, String) {
    match raw.find('\n') {
        None => (raw.trim().to_string(), String::new()),
        Some(nl) => (
            raw[..nl].trim().to_string(),
            raw[nl + 1..]
                .trim_start_matches('\n')
                .trim_end()
                .to_string(),
        ),
    }
}

async fn resolve_onto(
    ctx: &SignedCommitCtx,
    input: &SignedRewriteInput,
    base_branch: Option<&str>,
) -> Result<String> {
    if let Some(onto) = &input.onto {
        return git_text(&["rev-parse", &format!("{onto}^{{commit}}")], &ctx.cwd).await;
    }
    let Some(base_branch) = base_branch else {
        bail!("Could not determine the base branch — pass `onto` explicitly (e.g. origin/master).");
    };
    git_text(
        &["merge-base", &format!("origin/{base_branch}"), "HEAD"],
        &ctx.cwd,
    )
    .await
}

/// Republishes the current local branch as GitHub-signed history and
/// force-updates the remote branch onto it — the signed-commit equivalent of
/// `git push --force`.
pub async fn create_signed_rewrite(
    ctx: &SignedCommitCtx,
    input: &SignedRewriteInput,
) -> Result<SignedCommitResult> {
    let (repo, branch) = tokio::try_join!(
        resolve_repo_name_with_owner(ctx),
        resolve_branch_name(ctx, input.branch.as_deref()),
    )?;

    // Rewrite only updates existing history — a brand-new branch goes through
    // create_signed_commit instead.
    let Some(stale_tip) = remote_tip(ctx, &branch).await? else {
        bail!(
            "Branch '{branch}' does not exist on the remote. Use git_signed_commit to create it first."
        );
    };

    let base_branch = resolve_base_branch(ctx).await;
    if let Some(base_branch) = &base_branch {
        run_git(&["fetch", "--no-tags", "origin", base_branch], &ctx.cwd).await;
    }
    let onto = resolve_onto(ctx, input, base_branch.as_deref()).await?;

    // HEAD must descend from `onto` so `onto..HEAD` is exactly the set to replay.
    let ancestry = run_git(&["merge-base", "--is-ancestor", &onto, "HEAD"], &ctx.cwd).await;
    if ancestry.exit_code != 0 {
        bail!(
            "Local HEAD is not based on {onto} — rebase onto the base branch first, then call git_signed_rewrite."
        );
    }

    // Replaying first-parent diffs across a local merge folds the entire
    // merged-in branch into one giant commit attributed to this PR.
    let merge_count = git_text(
        &["rev-list", "--count", "--merges", &format!("{onto}..HEAD")],
        &ctx.cwd,
    )
    .await?;
    if merge_count != "0" {
        let short_onto: String = onto.chars().take(12).collect();
        bail!(
            "Refusing to rewrite: {short_onto}..HEAD contains {merge_count} merge commit(s), \
             and replaying them would dump every merged-in change (e.g. the whole base branch) \
             into this PR. Recovery: `git rebase origin/<base>` (a rebase flattens merges), \
             resolve any conflicts, `git rebase --continue`, then retry git_signed_rewrite. \
             To simply bring the base branch into the PR, use `git_signed_merge` instead."
        );
    }

    let list = git_text(
        &[
            "rev-list",
            "--reverse",
            "--first-parent",
            &format!("{onto}..HEAD"),
        ],
        &ctx.cwd,
    )
    .await?;
    let local_commits: Vec<&str> = list.split('\n').filter(|s| !s.is_empty()).collect();
    if local_commits.is_empty() {
        bail!("No commits between {onto} and HEAD to publish.");
    }

    let scratch = format!("posthog-code/rewrite-tmp/{}", uuid::Uuid::new_v4());
    create_ref(ctx, &repo, &scratch, &onto).await?;

    let result: Result<SignedCommitResult> = async {
        let mut commits: Vec<CommitRef> = Vec::new();
        let mut expected_head_oid = onto.clone();
        let mut prev_tree = onto.clone();
        for sha in &local_commits {
            let changes = build_file_changes_between(ctx, &prev_tree, sha).await?;
            prev_tree = sha.to_string();
            // Skip empty commits (e.g. a merge that's a no-op on the
            // first-parent line) — createCommitOnBranch rejects an empty
            // fileChanges payload.
            if changes.is_empty() {
                continue;
            }
            let message = git_text(&["log", "-1", "--format=%B", sha], &ctx.cwd).await?;
            let (headline, body) = split_commit_message(&message);
            let (published, new_tip) = publish_changes(
                ctx,
                &repo,
                &scratch,
                &expected_head_oid,
                &headline,
                &body,
                changes,
            )
            .await?;
            commits.extend(published);
            expected_head_oid = new_tip;
        }

        if commits.is_empty() {
            bail!("Nothing to publish — every commit was empty after diffing.");
        }

        let current_tip = remote_tip(ctx, &branch).await?;
        if current_tip.as_deref() != Some(stale_tip.as_str()) {
            bail!(
                "Branch '{branch}' moved while rewriting (expected {stale_tip}, found {}). Re-fetch and retry.",
                current_tip.as_deref().unwrap_or("null")
            );
        }
        force_update_ref(ctx, &repo, &branch, &expected_head_oid).await?;
        sync_local_checkout(ctx, &branch, &expected_head_oid).await;
        Ok(SignedCommitResult {
            branch: branch.clone(),
            repository: repo.clone(),
            commits,
        })
    }
    .await;

    // The history is already published via the ref move; the scratch ref is
    // just bookkeeping, so a delete failure is non-fatal.
    let _ = delete_ref(ctx, &repo, &scratch).await;
    result
}

// ---------------------------------------------------------------------------
// git_signed_merge

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeApiOutcome {
    Merged { sha: String, url: String },
    UpToDate,
    Conflict,
    Forbidden,
    Error { message: String },
}

/// Pure mapping of a `gh api /repos/:repo/merges` result to a merge outcome.
pub fn interpret_merge_api_result(res: &GhResult) -> MergeApiOutcome {
    if res.exit_code == 0 {
        let body = res.stdout.trim();
        if body.is_empty() {
            return MergeApiOutcome::UpToDate; // HTTP 204: nothing to merge
        }
        if let Ok(parsed) = serde_json::from_str::<Value>(body) {
            if let Some(sha) = parsed.get("sha").and_then(Value::as_str) {
                return MergeApiOutcome::Merged {
                    sha: sha.to_string(),
                    url: parsed
                        .get("html_url")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                };
            }
        }
        return MergeApiOutcome::Error {
            message: format!(
                "unexpected merge response: {}",
                body.chars().take(300).collect::<String>()
            ),
        };
    }
    let err_text = format!(
        "{} {} {}",
        res.stderr,
        res.error.as_deref().unwrap_or(""),
        res.stdout
    );
    if err_text.contains("HTTP 409") {
        return MergeApiOutcome::Conflict;
    }
    if err_text.contains("HTTP 403") || err_text.contains("HTTP 404") {
        return MergeApiOutcome::Forbidden;
    }
    let message = [
        res.stderr.as_str(),
        res.error.as_deref().unwrap_or(""),
        res.stdout.as_str(),
    ]
    .iter()
    .find(|s| !s.is_empty())
    .copied()
    .unwrap_or("")
    .trim()
    .to_string();
    MergeApiOutcome::Error { message }
}

/// Merges the base branch INTO the PR branch as a true two-parent merge commit
/// created server-side by GitHub (`POST /repos/{repo}/merges` — the API behind
/// the "Update branch" button), so the commit is GitHub-signed and no history
/// is rewritten. Conflicting merges are refused by GitHub; the caller is
/// directed to the rebase + git_signed_rewrite path instead.
pub async fn create_signed_merge(
    ctx: &SignedCommitCtx,
    input: &SignedMergeInput,
) -> Result<SignedMergeResult> {
    // A half-finished local merge/rebase would make the post-merge sync land on
    // top of a dirty state; refuse with the same guidance as the commit path.
    if let Some(op) = detect_operation_in_progress(&ctx.cwd).await? {
        bail!(operation_in_progress_error(op));
    }

    let (repo, branch) = tokio::try_join!(
        resolve_repo_name_with_owner(ctx),
        resolve_branch_name(ctx, input.branch.as_deref()),
    )?;

    let base = match &input.base {
        Some(base) => base.clone(),
        None => resolve_base_branch(ctx).await.ok_or_else(|| {
            anyhow!("Could not determine the base branch — pass `base` explicitly (e.g. master).")
        })?,
    };
    if base == branch {
        bail!("Cannot merge '{base}' into itself.");
    }

    let Some(tip) = remote_tip(ctx, &branch).await? else {
        bail!(
            "Branch '{branch}' does not exist on the remote. Use git_signed_commit to create it first."
        );
    };

    // Only sync the working tree afterwards when it is actually on the target
    // branch — and in that case require it to be clean and published, so the
    // fast-forward below is guaranteed to apply.
    let current_branch = String::from_utf8_lossy(
        &run_git(&["rev-parse", "--abbrev-ref", "HEAD"], &ctx.cwd)
            .await
            .stdout,
    )
    .trim()
    .to_string();
    let on_target_branch = current_branch == branch;
    if on_target_branch {
        let status = git_text(&["status", "--porcelain", "--untracked-files=no"], &ctx.cwd).await?;
        if !status.is_empty() {
            bail!(
                "Local checkout has uncommitted changes. Commit them first with git_signed_commit \
                 (the merge updates the working tree), then retry git_signed_merge."
            );
        }
        let head = git_text(&["rev-parse", "HEAD"], &ctx.cwd).await?;
        if head != tip {
            let short_head: String = head.chars().take(12).collect();
            let short_tip: String = tip.chars().take(12).collect();
            bail!(
                "Local HEAD ({short_head}) does not match the remote tip of '{branch}' \
                 ({short_tip}). Publish local commits with git_signed_commit (or reset to \
                 the remote tip) first, then retry."
            );
        }
    }

    let message = format!(
        "Merge branch '{base}' into {branch}\n\n{}",
        build_posthog_trailers(ctx.task_id.as_deref()).join("\n")
    );

    let res = exec_gh_with_retry(
        &[
            "api".into(),
            "-X".into(),
            "POST".into(),
            format!("/repos/{repo}/merges"),
            "-f".into(),
            format!("base={branch}"),
            "-f".into(),
            format!("head={base}"),
            "-f".into(),
            format!("commit_message={message}"),
        ],
        &GhOptions {
            timeout: Some(GH_GRAPHQL_TIMEOUT),
            ..gh_options(ctx)
        },
    )
    .await;

    let outcome = interpret_merge_api_result(&res);
    let (sha, url) = match outcome {
        MergeApiOutcome::UpToDate => {
            return Ok(SignedMergeResult::UpToDate { branch, base });
        }
        MergeApiOutcome::Conflict => {
            bail!(
                "Merge conflict between '{base}' and '{branch}' — GitHub cannot auto-merge. \
                 Recovery: `git fetch origin {base}`, `git rebase origin/{base}`, resolve \
                 conflicts, `git rebase --continue`, then call git_signed_rewrite to publish."
            );
        }
        MergeApiOutcome::Forbidden => {
            bail!(
                "GitHub refused the merge (HTTP 403/404): the token may lack push access to \
                 '{branch}', or the repo/branch was not found."
            );
        }
        MergeApiOutcome::Error { message } => {
            bail!("Merge API failed: {message}");
        }
        MergeApiOutcome::Merged { sha, url } => (sha, url),
    };

    // Sync the local checkout with a real fast-forward merge so the working
    // tree gains the base's changes. (`sync_local_checkout` would keep the old
    // tree, making the merge look like unstaged reversions — staging those
    // would silently undo it.)
    let mut local_sync_warning: Option<String> = None;
    if on_target_branch {
        let fetch_res = run_git(&["fetch", "--no-tags", "origin", &branch], &ctx.cwd).await;
        let sync_res = if fetch_res.exit_code == 0 {
            run_git(&["merge", "--ff-only", &sha], &ctx.cwd).await
        } else {
            fetch_res
        };
        if sync_res.exit_code != 0 {
            local_sync_warning = Some(format!(
                "the merge is on the remote, but syncing the local checkout failed \
                 ({}). Run `git fetch origin {branch} && \
                 git merge --ff-only origin/{branch}` before further local work.",
                sync_res.stderr.trim()
            ));
        }
    }

    Ok(SignedMergeResult::Merged {
        branch,
        base,
        commit: CommitRef { sha, url },
        local_sync_warning,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_github_remote_urls() {
        for (url, expected) in [
            (
                "https://github.com/PostHog/posthog.git",
                Some(("PostHog", "posthog")),
            ),
            (
                "https://github.com/PostHog/posthog",
                Some(("PostHog", "posthog")),
            ),
            (
                "https://x-access-token:ghs_secret@github.com/PostHog/code.git",
                Some(("PostHog", "code")),
            ),
            (
                "git@github.com:PostHog/posthog.git",
                Some(("PostHog", "posthog")),
            ),
            (
                "ssh://git@github.com/PostHog/posthog.git",
                Some(("PostHog", "posthog")),
            ),
            ("https://gitlab.com/foo/bar.git", None),
            ("https://api.github.com/repos/foo/bar", None),
            ("", None),
        ] {
            let parsed = parse_github_owner_repo(url);
            let parsed_ref = parsed.as_ref().map(|(o, r)| (o.as_str(), r.as_str()));
            assert_eq!(parsed_ref, expected, "url: {url}");
        }
    }

    #[test]
    fn splits_commit_messages() {
        assert_eq!(
            split_commit_message("feat: one-liner"),
            ("feat: one-liner".to_string(), String::new())
        );
        assert_eq!(
            split_commit_message("feat: headline\n\nbody line 1\nbody line 2\n"),
            (
                "feat: headline".to_string(),
                "body line 1\nbody line 2".to_string()
            )
        );
    }

    #[test]
    fn trailers_include_task_id_when_present() {
        assert_eq!(
            build_posthog_trailers(Some("task-1")),
            vec!["Generated-By: PostHog Code", "Task-Id: task-1"]
        );
        assert_eq!(
            build_posthog_trailers(None),
            vec!["Generated-By: PostHog Code"]
        );
    }

    #[test]
    fn chunking_splits_and_rejects_oversized() {
        let changes = FileChanges {
            additions: vec![
                FileAddition {
                    path: "a".into(),
                    contents: "x".repeat(50),
                },
                FileAddition {
                    path: "b".into(),
                    contents: "y".repeat(50),
                },
                FileAddition {
                    path: "c".into(),
                    contents: "z".repeat(50),
                },
            ],
            deletions: vec!["gone".into()],
        };
        // Each addition is 50 + 1 + 32 = 83 bytes; the deletion seeds 20 bytes.
        let chunks = chunk_file_changes(changes, 200).unwrap();
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].additions.len(), 2);
        assert_eq!(chunks[0].deletions, vec!["gone".to_string()]);
        assert_eq!(chunks[1].additions.len(), 1);
        assert!(chunks[1].deletions.is_empty());

        let oversized = FileChanges {
            additions: vec![FileAddition {
                path: "big".into(),
                contents: "x".repeat(300),
            }],
            deletions: vec![],
        };
        let err = chunk_file_changes(oversized, 200).unwrap_err();
        assert!(err
            .to_string()
            .contains("exceeds the per-commit request limit"));
    }

    #[test]
    fn parses_raw_diff_z_and_detects_leaks() {
        let raw =
            ":100644 100644 aaa bbb M\0src/kept.ts\0:100644 000000 ccc 0000000 D\0src/gone.ts\0";
        let entries = parse_raw_diff_z(raw);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "src/kept.ts");
        assert_eq!(entries[0].new_oid, "bbb");
        assert_eq!(entries[1].status, "D");

        let pr_files: HashSet<String> = ["src/kept.ts".to_string()].into_iter().collect();
        let base_changed: HashMap<String, String> =
            [("src/gone.ts".to_string(), "0000000".to_string())]
                .into_iter()
                .collect();
        let leaks = detect_base_leaks(&entries, &pr_files, &base_changed);
        assert_eq!(leaks, vec!["src/gone.ts".to_string()]);
    }

    #[test]
    fn merge_api_result_mapping() {
        let merged = GhResult {
            stdout: r#"{"sha":"abc123","html_url":"https://github.com/o/r/commit/abc123"}"#.into(),
            exit_code: 0,
            ..Default::default()
        };
        assert_eq!(
            interpret_merge_api_result(&merged),
            MergeApiOutcome::Merged {
                sha: "abc123".into(),
                url: "https://github.com/o/r/commit/abc123".into()
            }
        );

        let up_to_date = GhResult {
            exit_code: 0,
            ..Default::default()
        };
        assert_eq!(
            interpret_merge_api_result(&up_to_date),
            MergeApiOutcome::UpToDate
        );

        let conflict = GhResult {
            stderr: "HTTP 409: Merge conflict".into(),
            exit_code: 1,
            ..Default::default()
        };
        assert_eq!(
            interpret_merge_api_result(&conflict),
            MergeApiOutcome::Conflict
        );

        let forbidden = GhResult {
            stderr: "HTTP 404: Not Found".into(),
            exit_code: 1,
            ..Default::default()
        };
        assert_eq!(
            interpret_merge_api_result(&forbidden),
            MergeApiOutcome::Forbidden
        );
    }

    #[test]
    fn parses_nul_delimited_env() {
        let env = parse_nul_delimited_env("GH_TOKEN=ghs_abc\0FOO=bar=baz\0\0=broken\0plain");
        assert_eq!(env.get("GH_TOKEN").map(String::as_str), Some("ghs_abc"));
        assert_eq!(env.get("FOO").map(String::as_str), Some("bar=baz"));
        assert!(!env.contains_key(""));
        assert!(!env.contains_key("plain"));
    }
}
