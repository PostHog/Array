//! Git handoff checkpoints: capture and apply.
//!
//! Port of `@posthog/git`'s `CaptureCheckpointSaga` + `GitHandoffTracker` and
//! the agent package's `HandoffCheckpointTracker`. A checkpoint is a commit
//! whose meta tree references the index tree and a synthesized worktree tree;
//! for handoff the unreachable objects are packed (`git pack-objects`) and
//! uploaded — with the raw `.git/index` file — as base64 run artifacts.
//!
//! All git access shells out to the `git` CLI exactly like the TS
//! implementation; blobs over 1 MiB are reconciled back to their HEAD version
//! (or dropped) so handoff artifacts stay small.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use base64::Engine;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;

use crate::iso_now;
use crate::posthog_api::PostHogApiClient;

const CHECKPOINT_REF_PREFIX: &str = "refs/posthog-code-checkpoint/";
const HANDOFF_HEAD_REF_PREFIX: &str = "refs/posthog-code-handoff/head/";
const CHECKPOINT_VERSION: &str = "v1";
const MAX_HANDOFF_FILE_BYTES: u64 = 1024 * 1024;
const CHECKPOINT_AUTHOR_NAME: &str = "PostHog Code";
const CHECKPOINT_AUTHOR_EMAIL: &str = "posthog-code@local";

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct CheckpointError(pub String);

type Result<T> = std::result::Result<T, CheckpointError>;

/// The `GitCheckpoint` payload broadcast as `_posthog/git_checkpoint` params
/// (camelCase wire names must match the TS type).
#[derive(Debug, Clone)]
pub struct GitCheckpoint {
    pub checkpoint_id: String,
    pub commit: String,
    pub checkpoint_ref: String,
    pub head_ref: Option<String>,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub index_tree: String,
    pub worktree_tree: String,
    pub timestamp: String,
    pub upstream_remote: Option<String>,
    pub upstream_merge_ref: Option<String>,
    pub remote_url: Option<String>,
    pub artifact_path: Option<String>,
    pub index_artifact_path: Option<String>,
}

impl GitCheckpoint {
    pub fn to_event_params(&self, device: &Value) -> Value {
        json!({
            "checkpointId": self.checkpoint_id,
            "commit": self.commit,
            "checkpointRef": self.checkpoint_ref,
            "headRef": self.head_ref,
            "head": self.head,
            "branch": self.branch,
            "indexTree": self.index_tree,
            "worktreeTree": self.worktree_tree,
            "timestamp": self.timestamp,
            "upstreamRemote": self.upstream_remote,
            "upstreamMergeRef": self.upstream_merge_ref,
            "remoteUrl": self.remote_url,
            "artifactPath": self.artifact_path,
            "indexArtifactPath": self.index_artifact_path,
            "device": device,
        })
    }

    pub fn from_event_params(params: &Value) -> Option<Self> {
        let get = |key: &str| params.get(key).and_then(Value::as_str).map(str::to_string);
        Some(Self {
            checkpoint_id: get("checkpointId")?,
            commit: get("commit").unwrap_or_default(),
            checkpoint_ref: get("checkpointRef")?,
            head_ref: get("headRef"),
            head: get("head"),
            branch: get("branch"),
            index_tree: get("indexTree").unwrap_or_default(),
            worktree_tree: get("worktreeTree")?,
            timestamp: get("timestamp").unwrap_or_default(),
            upstream_remote: get("upstreamRemote"),
            upstream_merge_ref: get("upstreamMergeRef"),
            remote_url: get("remoteUrl"),
            artifact_path: get("artifactPath"),
            index_artifact_path: get("indexArtifactPath"),
        })
    }
}

/// The `localGitState` shape from the `close` command / handoff flows.
#[derive(Debug, Clone, Default)]
pub struct LocalGitState {
    pub upstream_head: Option<String>,
    pub upstream_remote: Option<String>,
    pub upstream_merge_ref: Option<String>,
}

impl LocalGitState {
    pub fn from_value(value: &Value) -> Self {
        let get = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_string);
        Self {
            upstream_head: get("upstreamHead"),
            upstream_remote: get("upstreamRemote"),
            upstream_merge_ref: get("upstreamMergeRef"),
        }
    }
}

pub struct HandoffTracker<'a> {
    pub repository_path: &'a str,
    pub task_id: &'a str,
    pub run_id: &'a str,
    pub api: &'a PostHogApiClient,
}

impl HandoffTracker<'_> {
    /// `captureForHandoff`: capture a checkpoint, reconcile the index, pack
    /// unreachable objects, and upload pack + index as run artifacts.
    pub async fn capture_for_handoff(
        &self,
        local_git_state: Option<&LocalGitState>,
    ) -> Result<GitCheckpoint> {
        let repo = self.repository_path;
        let state = capture_checkpoint(repo).await?;
        let temp_dir = tempdir(&state.checkpoint_id).await?;

        let result = self
            .capture_and_upload(repo, &state, &temp_dir, local_git_state)
            .await;

        // Cleanup mirrors TS: drop the checkpoint ref and temp files whether
        // or not the upload succeeded.
        let _ = git(
            repo,
            &[
                "update-ref",
                "-d",
                &format!("{CHECKPOINT_REF_PREFIX}{}", state.checkpoint_id),
            ],
        )
        .await;
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;

        result
    }

    async fn capture_and_upload(
        &self,
        repo: &str,
        state: &CheckpointState,
        temp_dir: &Path,
        local_git_state: Option<&LocalGitState>,
    ) -> Result<GitCheckpoint> {
        let reconciled = reconcile_handoff_index(repo, state, temp_dir).await?;

        let pack_baseline = local_git_state.and_then(|s| s.upstream_head.clone());
        let mut pack_refs: Vec<String> = Vec::new();
        if let Some(head) = &state.head {
            pack_refs.push(head.clone());
        }
        pack_refs.push(reconciled.index_tree.clone());
        pack_refs.push(state.worktree_tree.clone());
        if let Some(baseline) = &pack_baseline {
            pack_refs.push(format!("^{baseline}"));
        }

        let pack_prefix = temp_dir.join(&state.checkpoint_id);
        let pack_path = capture_object_pack(repo, &pack_prefix, &pack_refs).await?;
        let tracking = tracking_metadata(repo, state.branch.as_deref()).await;

        let pack_upload = match &pack_path {
            Some(path) => Some(
                self.upload_artifact_file(
                    path,
                    &format!("handoff/{}.pack", state.checkpoint_id),
                    "application/x-git-packed-objects",
                )
                .await?,
            ),
            None => None,
        };
        let index_upload = self
            .upload_artifact_file(
                &reconciled.index_file_path,
                &format!("handoff/{}.index", state.checkpoint_id),
                "application/octet-stream",
            )
            .await?;

        Ok(GitCheckpoint {
            checkpoint_id: state.checkpoint_id.clone(),
            commit: state.commit.clone(),
            checkpoint_ref: format!("{CHECKPOINT_REF_PREFIX}{}", state.checkpoint_id),
            head_ref: state
                .head
                .as_ref()
                .map(|_| format!("{HANDOFF_HEAD_REF_PREFIX}{}", state.checkpoint_id)),
            head: state.head.clone(),
            branch: state.branch.clone(),
            index_tree: reconciled.index_tree,
            worktree_tree: state.worktree_tree.clone(),
            timestamp: state.timestamp.clone(),
            upstream_remote: tracking.upstream_remote,
            upstream_merge_ref: tracking.upstream_merge_ref,
            remote_url: tracking.remote_url,
            artifact_path: pack_upload.flatten(),
            index_artifact_path: index_upload,
        })
    }

    /// `applyFromHandoff`: download pack + index and restore the worktree.
    /// Diverged branches abort (cloud resume has no interactive confirmation).
    pub async fn apply_from_handoff(&self, checkpoint: &GitCheckpoint) -> Result<()> {
        let repo = self.repository_path;
        let temp_dir = tempdir(&checkpoint.checkpoint_id).await?;
        let result = self.apply_inner(repo, checkpoint, &temp_dir).await;
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;
        result
    }

    async fn apply_inner(
        &self,
        repo: &str,
        checkpoint: &GitCheckpoint,
        temp_dir: &Path,
    ) -> Result<()> {
        let pack_path = match &checkpoint.artifact_path {
            Some(storage_path) => Some(
                self.download_artifact_to_file(
                    storage_path,
                    &temp_dir.join(format!("{}.pack", checkpoint.checkpoint_id)),
                )
                .await?,
            ),
            None => None,
        };
        let index_path = match &checkpoint.index_artifact_path {
            Some(storage_path) => Some(
                self.download_artifact_to_file(
                    storage_path,
                    &temp_dir.join(format!("{}.index", checkpoint.checkpoint_id)),
                )
                .await?,
            ),
            None => None,
        };

        if let Some(pack_path) = &pack_path {
            ensure_baseline_for_apply(repo, checkpoint).await;
            unpack_pack_file(repo, pack_path).await?;
        }

        match (&checkpoint.branch, &checkpoint.head) {
            (Some(branch), Some(head)) => {
                let status = branch_restore_status(repo, branch, head).await?;
                if let BranchRestoreStatus::Diverged { local_head } = &status {
                    return Err(CheckpointError(format!(
                        "Handoff aborted: local branch '{branch}' has diverged (local {local_head}, cloud {head})"
                    )));
                }
                checkout_branch_at_head(repo, branch, head).await?;
                if matches!(status, BranchRestoreStatus::Missing)
                    && (checkpoint.upstream_remote.is_some()
                        || checkpoint.upstream_merge_ref.is_some())
                {
                    ensure_remote(repo, checkpoint).await;
                    configure_upstream(repo, branch, checkpoint).await;
                }
            }
            (None, Some(head)) => {
                git(repo, &["checkout", head]).await?;
            }
            _ => {}
        }

        git(repo, &["clean", "-f", "-d"]).await?;
        git(
            repo,
            &["read-tree", "--reset", "-u", &checkpoint.worktree_tree],
        )
        .await?;

        if let Some(index_path) = &index_path {
            let git_index = git_path(repo, "index").await?;
            tokio::fs::copy(index_path, git_index)
                .await
                .map_err(|e| CheckpointError(format!("restore index: {e}")))?;
        }
        Ok(())
    }

    async fn upload_artifact_file(
        &self,
        file_path: &Path,
        name: &str,
        content_type: &str,
    ) -> Result<Option<String>> {
        let content = tokio::fs::read(file_path)
            .await
            .map_err(|e| CheckpointError(format!("read {}: {e}", file_path.display())))?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&content);
        let storage_path = self
            .api
            .upload_task_artifacts(
                self.task_id,
                self.run_id,
                vec![json!({
                    "name": name,
                    "type": "artifact",
                    "content": encoded,
                    "content_type": content_type,
                })],
            )
            .await
            .map_err(|e| CheckpointError(e.to_string()))?
            .last()
            .and_then(|a| {
                a.get("storage_path")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
        Ok(storage_path)
    }

    async fn download_artifact_to_file(
        &self,
        storage_path: &str,
        file_path: &Path,
    ) -> Result<PathBuf> {
        let data = self
            .api
            .download_artifact(self.task_id, self.run_id, storage_path)
            .await
            .map_err(|e| CheckpointError(e.to_string()))?;
        // Handoff artifacts are stored base64-encoded (see upload above).
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(String::from_utf8_lossy(&data).trim())
            .map_err(|e| CheckpointError(format!("decode {storage_path}: {e}")))?;
        tokio::fs::write(file_path, decoded)
            .await
            .map_err(|e| CheckpointError(format!("write {}: {e}", file_path.display())))?;
        Ok(file_path.to_path_buf())
    }
}

#[derive(Debug)]
struct CheckpointState {
    checkpoint_id: String,
    commit: String,
    head: Option<String>,
    branch: Option<String>,
    index_tree: String,
    worktree_tree: String,
    timestamp: String,
}

/// `CaptureCheckpointSaga`: synthesize index + worktree trees and commit them
/// under a checkpoint ref.
async fn capture_checkpoint(repo: &str) -> Result<CheckpointState> {
    let head = git_ok(repo, &["rev-parse", "HEAD"]).await;
    let branch = git_ok(repo, &["symbolic-ref", "--short", "HEAD"]).await;

    if let Some(operation) = git_busy_operation(repo).await {
        return Err(CheckpointError(format!(
            "Cannot capture checkpoint while git operation is in progress: {operation}"
        )));
    }
    let unmerged = git(repo, &["ls-files", "--unmerged"]).await?;
    if !unmerged.trim().is_empty() {
        return Err(CheckpointError(
            "Cannot capture checkpoint with unresolved merge conflicts in the index".to_string(),
        ));
    }

    let index_tree = git(repo, &["write-tree"]).await?.trim().to_string();
    let worktree_tree = create_worktree_tree(repo, head.as_deref()).await?;
    let meta_tree = create_meta_tree(repo, &index_tree, &worktree_tree).await?;

    let timestamp = iso_now();
    let message = [
        format!("POSTHOG-CODE-CHECKPOINT {CHECKPOINT_VERSION}"),
        format!("head={}", head.as_deref().unwrap_or("null")),
        format!("branch={}", branch.as_deref().unwrap_or("null")),
        format!("index={index_tree}"),
        format!("worktree={worktree_tree}"),
        format!("timestamp={timestamp}"),
    ]
    .join("\n");

    let mut commit_args: Vec<&str> = vec!["commit-tree", &meta_tree];
    if let Some(head) = &head {
        commit_args.extend(["-p", head]);
    }
    commit_args.extend(["-m", &message]);
    let commit = git_with_env(
        repo,
        &commit_args,
        &[
            ("GIT_AUTHOR_NAME", CHECKPOINT_AUTHOR_NAME),
            ("GIT_AUTHOR_EMAIL", CHECKPOINT_AUTHOR_EMAIL),
            ("GIT_COMMITTER_NAME", CHECKPOINT_AUTHOR_NAME),
            ("GIT_COMMITTER_EMAIL", CHECKPOINT_AUTHOR_EMAIL),
        ],
    )
    .await?
    .trim()
    .to_string();

    let checkpoint_id = uuid::Uuid::new_v4().to_string();
    let ref_name = format!("{CHECKPOINT_REF_PREFIX}{checkpoint_id}");
    git(repo, &["update-ref", &ref_name, &commit]).await?;

    Ok(CheckpointState {
        checkpoint_id,
        commit,
        head,
        branch,
        index_tree,
        worktree_tree,
        timestamp,
    })
}

async fn git_busy_operation(repo: &str) -> Option<&'static str> {
    for (path, operation) in [
        ("rebase-merge", "rebase"),
        ("rebase-apply", "rebase"),
        ("MERGE_HEAD", "merge"),
        ("CHERRY_PICK_HEAD", "cherry-pick"),
        ("REVERT_HEAD", "revert"),
    ] {
        if let Ok(resolved) = git_path(repo, path).await {
            if tokio::fs::try_exists(&resolved).await.unwrap_or(false) {
                return Some(operation);
            }
        }
    }
    None
}

/// Worktree tree via a temporary index: read HEAD, `add -A`, drop >1MiB blobs
/// back to their HEAD versions, `write-tree`.
async fn create_worktree_tree(repo: &str, head: Option<&str>) -> Result<String> {
    let temp_index = temp_index_path(repo, "checkpoint-worktree").await?;
    let env = [("GIT_INDEX_FILE", temp_index.to_str().unwrap_or_default())];

    let result: Result<String> = async {
        match head {
            Some(head) => git_with_env(repo, &["read-tree", head], &env).await?,
            None => git_with_env(repo, &["read-tree", "--empty"], &env).await?,
        };
        git_with_env(repo, &["add", "-A", "--", "."], &env).await?;
        reconcile_large_blobs(repo, head, &env).await?;
        Ok(git_with_env(repo, &["write-tree"], &env)
            .await?
            .trim()
            .to_string())
    }
    .await;

    let _ = tokio::fs::remove_file(&temp_index).await;
    result
}

async fn reconcile_large_blobs(repo: &str, head: Option<&str>, env: &[(&str, &str)]) -> Result<()> {
    let intermediate = git_with_env(repo, &["write-tree"], env)
        .await?
        .trim()
        .to_string();
    let large_paths = list_large_blob_paths(repo, &intermediate, MAX_HANDOFF_FILE_BYTES).await?;
    if large_paths.is_empty() {
        return Ok(());
    }
    let head_blobs = match head {
        Some(head) => read_head_blob_entries(repo, head, &large_paths).await,
        None => HashMap::new(),
    };
    for file_path in &large_paths {
        match head_blobs.get(file_path) {
            Some((mode, hash)) => {
                git_with_env(
                    repo,
                    &[
                        "update-index",
                        "--cacheinfo",
                        &format!("{mode},{hash},{file_path}"),
                    ],
                    env,
                )
                .await?;
            }
            None => {
                let _ =
                    git_with_env(repo, &["update-index", "--force-remove", file_path], env).await;
            }
        }
    }
    Ok(())
}

async fn list_large_blob_paths(repo: &str, tree: &str, max_bytes: u64) -> Result<Vec<String>> {
    let output = git(repo, &["ls-tree", "-r", "-l", tree]).await?;
    let mut result = Vec::new();
    for line in output.lines() {
        let Some((meta, file_path)) = line.split_once('\t') else {
            continue;
        };
        let parts: Vec<&str> = meta.split_whitespace().collect();
        if parts.len() < 4 || parts[1] != "blob" || parts[3] == "-" {
            continue;
        }
        if let Ok(size) = parts[3].parse::<u64>() {
            if size > max_bytes {
                result.push(file_path.to_string());
            }
        }
    }
    Ok(result)
}

async fn read_head_blob_entries(
    repo: &str,
    head: &str,
    paths: &[String],
) -> HashMap<String, (String, String)> {
    let mut result = HashMap::new();
    for chunk in paths.chunks(100) {
        let mut args: Vec<&str> = vec!["ls-tree", "-r", head, "--"];
        args.extend(chunk.iter().map(String::as_str));
        let Ok(output) = git(repo, &args).await else {
            continue;
        };
        for line in output.lines() {
            let Some((meta, file_path)) = line.split_once('\t') else {
                continue;
            };
            let parts: Vec<&str> = meta.split_whitespace().collect();
            if parts.len() < 3 || parts[1] != "blob" {
                continue;
            }
            result.insert(
                file_path.to_string(),
                (parts[0].to_string(), parts[2].to_string()),
            );
        }
    }
    result
}

/// Meta tree: `index/` and `worktree/` subtree entries.
async fn create_meta_tree(repo: &str, index_tree: &str, worktree_tree: &str) -> Result<String> {
    let temp_index = temp_index_path(repo, "checkpoint-meta").await?;
    let env = [("GIT_INDEX_FILE", temp_index.to_str().unwrap_or_default())];

    let result: Result<String> = async {
        git_with_env(repo, &["read-tree", "--empty"], &env).await?;
        git_with_env(
            repo,
            &[
                "update-index",
                "--add",
                "--cacheinfo",
                "040000",
                index_tree,
                "index",
            ],
            &env,
        )
        .await?;
        git_with_env(
            repo,
            &[
                "update-index",
                "--add",
                "--cacheinfo",
                "040000",
                worktree_tree,
                "worktree",
            ],
            &env,
        )
        .await?;
        Ok(git_with_env(repo, &["write-tree"], &env)
            .await?
            .trim()
            .to_string())
    }
    .await;

    let _ = tokio::fs::remove_file(&temp_index).await;
    result
}

struct ReconciledIndex {
    index_tree: String,
    index_file_path: PathBuf,
}

/// Copy `.git/index` aside and rewrite >1MiB entries to their HEAD versions.
async fn reconcile_handoff_index(
    repo: &str,
    state: &CheckpointState,
    temp_dir: &Path,
) -> Result<ReconciledIndex> {
    let real_index = git_path(repo, "index").await?;
    let temp_index = temp_dir.join(format!("{}.index", state.checkpoint_id));
    tokio::fs::copy(&real_index, &temp_index)
        .await
        .map_err(|e| CheckpointError(format!("copy index: {e}")))?;

    let large_paths =
        list_large_blob_paths(repo, &state.index_tree, MAX_HANDOFF_FILE_BYTES).await?;
    if large_paths.is_empty() {
        return Ok(ReconciledIndex {
            index_tree: state.index_tree.clone(),
            index_file_path: temp_index,
        });
    }

    let env = [("GIT_INDEX_FILE", temp_index.to_str().unwrap_or_default())];
    let head_blobs = match &state.head {
        Some(head) => read_head_blob_entries(repo, head, &large_paths).await,
        None => HashMap::new(),
    };
    for file_path in &large_paths {
        match head_blobs.get(file_path) {
            Some((mode, hash)) => {
                git_with_env(
                    repo,
                    &[
                        "update-index",
                        "--cacheinfo",
                        &format!("{mode},{hash},{file_path}"),
                    ],
                    &env,
                )
                .await?;
            }
            None => {
                let _ =
                    git_with_env(repo, &["update-index", "--force-remove", file_path], &env).await;
            }
        }
    }
    let reconciled_tree = git_with_env(repo, &["write-tree"], &env)
        .await?
        .trim()
        .to_string();
    Ok(ReconciledIndex {
        index_tree: reconciled_tree,
        index_file_path: temp_index,
    })
}

/// `git pack-objects <prefix> --revs` with the refs on stdin. Returns None
/// when the pack would be empty (pack-objects still writes a pack; a fully
/// excluded baseline yields an empty-but-valid pack, which we keep).
async fn capture_object_pack(
    repo: &str,
    prefix: &Path,
    refs: &[String],
) -> Result<Option<PathBuf>> {
    let input = format!("{}\n", refs.join("\n"));
    let stdout = git_with_stdin(
        repo,
        &[
            "pack-objects",
            prefix.to_str().unwrap_or_default(),
            "--revs",
        ],
        input.as_bytes(),
    )
    .await?;
    let hash = stdout.trim();
    if hash.is_empty() {
        return Ok(None);
    }
    let pack_path = PathBuf::from(format!("{}-{hash}.pack", prefix.display()));
    let _ = tokio::fs::remove_file(format!("{}-{hash}.idx", prefix.display())).await;
    Ok(Some(pack_path))
}

async fn unpack_pack_file(repo: &str, pack_path: &Path) -> Result<()> {
    let content = tokio::fs::read(pack_path)
        .await
        .map_err(|e| CheckpointError(format!("read pack: {e}")))?;
    git_with_stdin(repo, &["unpack-objects", "-r"], &content).await?;
    Ok(())
}

struct TrackingMetadata {
    upstream_remote: Option<String>,
    upstream_merge_ref: Option<String>,
    remote_url: Option<String>,
}

async fn tracking_metadata(repo: &str, branch: Option<&str>) -> TrackingMetadata {
    let Some(branch) = branch else {
        return TrackingMetadata {
            upstream_remote: None,
            upstream_merge_ref: None,
            remote_url: None,
        };
    };
    let upstream_remote = git_ok(
        repo,
        &["config", "--get", &format!("branch.{branch}.remote")],
    )
    .await;
    let upstream_merge_ref = git_ok(
        repo,
        &["config", "--get", &format!("branch.{branch}.merge")],
    )
    .await;
    let remote_url = match &upstream_remote {
        Some(remote) => git_ok(repo, &["remote", "get-url", remote]).await,
        None => None,
    };
    TrackingMetadata {
        upstream_remote,
        upstream_merge_ref,
        remote_url,
    }
}

enum BranchRestoreStatus {
    Missing,
    Match,
    FastForward,
    Diverged { local_head: String },
}

async fn branch_restore_status(
    repo: &str,
    branch: &str,
    cloud_head: &str,
) -> Result<BranchRestoreStatus> {
    let branch_ref = format!("refs/heads/{branch}");
    let Some(current_head) = git_ok(repo, &["rev-parse", "--verify", &branch_ref]).await else {
        return Ok(BranchRestoreStatus::Missing);
    };
    if current_head == cloud_head {
        return Ok(BranchRestoreStatus::Match);
    }
    let is_ancestor = git(
        repo,
        &["merge-base", "--is-ancestor", &current_head, cloud_head],
    )
    .await
    .is_ok();
    if is_ancestor {
        Ok(BranchRestoreStatus::FastForward)
    } else {
        Ok(BranchRestoreStatus::Diverged {
            local_head: current_head,
        })
    }
}

async fn checkout_branch_at_head(repo: &str, branch: &str, head: &str) -> Result<()> {
    let current = git_ok(repo, &["symbolic-ref", "--short", "HEAD"]).await;
    if current.as_deref() == Some(branch) {
        git(repo, &["reset", "--hard", head]).await?;
        return Ok(());
    }
    let branch_ref = format!("refs/heads/{branch}");
    if git_ok(repo, &["rev-parse", "--verify", &branch_ref])
        .await
        .is_some()
    {
        git(repo, &["branch", "-f", branch, head]).await?;
        git(repo, &["checkout", branch]).await?;
        return Ok(());
    }
    git(repo, &["checkout", "-b", branch, head]).await?;
    Ok(())
}

async fn ensure_baseline_for_apply(repo: &str, checkpoint: &GitCheckpoint) {
    let (Some(remote), Some(merge_ref)) =
        (&checkpoint.upstream_remote, &checkpoint.upstream_merge_ref)
    else {
        return;
    };
    ensure_remote(repo, checkpoint).await;
    if git(repo, &["fetch", remote, merge_ref]).await.is_err() {
        tracing::error!(
            remote,
            merge_ref,
            "Handoff baseline fetch failed; if the pack excludes commits the receiver does not already have, the subsequent unpack/read-tree will fail with an object-missing error"
        );
    }
}

async fn ensure_remote(repo: &str, checkpoint: &GitCheckpoint) {
    let (Some(remote), Some(url)) = (&checkpoint.upstream_remote, &checkpoint.remote_url) else {
        return;
    };
    if git_ok(repo, &["remote", "get-url", remote]).await.is_none() {
        let _ = git(repo, &["remote", "add", remote, url]).await;
    }
}

async fn configure_upstream(repo: &str, branch: &str, checkpoint: &GitCheckpoint) {
    if let Some(remote) = &checkpoint.upstream_remote {
        let _ = git(
            repo,
            &["config", &format!("branch.{branch}.remote"), remote],
        )
        .await;
    }
    if let Some(merge_ref) = &checkpoint.upstream_merge_ref {
        let _ = git(
            repo,
            &["config", &format!("branch.{branch}.merge"), merge_ref],
        )
        .await;
    }
}

async fn temp_index_path(repo: &str, label: &str) -> Result<PathBuf> {
    let common_dir_raw = git(repo, &["rev-parse", "--git-common-dir"]).await?;
    let common_dir_raw = common_dir_raw.trim();
    let common_dir = if Path::new(common_dir_raw).is_absolute() {
        PathBuf::from(common_dir_raw)
    } else {
        Path::new(repo).join(common_dir_raw)
    };
    let tmp_dir = common_dir.join("posthog-code-tmp");
    tokio::fs::create_dir_all(&tmp_dir)
        .await
        .map_err(|e| CheckpointError(format!("mkdir temp index dir: {e}")))?;
    Ok(tmp_dir.join(format!("{label}-{}", uuid::Uuid::new_v4())))
}

async fn tempdir(checkpoint_id: &str) -> Result<PathBuf> {
    let dir = std::env::temp_dir().join(format!(
        "posthog-code-handoff-{checkpoint_id}-{}",
        uuid::Uuid::new_v4()
    ));
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| CheckpointError(format!("mkdir temp dir: {e}")))?;
    Ok(dir)
}

async fn git_path(repo: &str, git_path_name: &str) -> Result<PathBuf> {
    let raw = git(repo, &["rev-parse", "--git-path", git_path_name]).await?;
    let resolved = raw.trim();
    Ok(if Path::new(resolved).is_absolute() {
        PathBuf::from(resolved)
    } else {
        Path::new(repo).join(resolved)
    })
}

async fn git(repo: &str, args: &[&str]) -> Result<String> {
    git_with_env(repo, args, &[]).await
}

/// Like `git`, but returns None on failure or empty output.
async fn git_ok(repo: &str, args: &[&str]) -> Option<String> {
    let output = git(repo, args).await.ok()?;
    let trimmed = output.trim().to_string();
    (!trimmed.is_empty()).then_some(trimmed)
}

async fn git_with_env(repo: &str, args: &[&str], env: &[(&str, &str)]) -> Result<String> {
    let mut command = tokio::process::Command::new("git");
    command.args(args).current_dir(repo);
    for (key, value) in env {
        command.env(key, value);
    }
    let output = command
        .output()
        .await
        .map_err(|e| CheckpointError(format!("git {}: {e}", args.join(" "))))?;
    if !output.status.success() {
        return Err(CheckpointError(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

async fn git_with_stdin(repo: &str, args: &[&str], input: &[u8]) -> Result<String> {
    let mut command = tokio::process::Command::new("git");
    command
        .args(args)
        .current_dir(repo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| CheckpointError(format!("git {}: {e}", args.join(" "))))?;
    let mut stdin = child.stdin.take().expect("piped stdin");
    stdin
        .write_all(input)
        .await
        .map_err(|e| CheckpointError(format!("git stdin: {e}")))?;
    drop(stdin);
    let output = child
        .wait_with_output()
        .await
        .map_err(|e| CheckpointError(format!("git {}: {e}", args.join(" "))))?;
    if !output.status.success() {
        return Err(CheckpointError(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Commit via plumbing: porcelain `git commit` may be blocked by
    /// signed-commit guards in agent sandboxes, and the production code only
    /// uses plumbing anyway.
    async fn plumbing_commit(repo: &str, message: &str) -> String {
        git(repo, &["add", "-A", "."]).await.unwrap();
        let tree = git(repo, &["write-tree"]).await.unwrap().trim().to_string();
        let parent = git_ok(repo, &["rev-parse", "HEAD"]).await;
        let mut args = vec!["commit-tree", tree.as_str()];
        if let Some(parent) = &parent {
            args.extend(["-p", parent.as_str()]);
        }
        args.extend(["-m", message]);
        let commit = git_with_env(
            repo,
            &args,
            &[
                ("GIT_AUTHOR_NAME", "t"),
                ("GIT_AUTHOR_EMAIL", "t@t"),
                ("GIT_COMMITTER_NAME", "t"),
                ("GIT_COMMITTER_EMAIL", "t@t"),
            ],
        )
        .await
        .unwrap()
        .trim()
        .to_string();
        git(repo, &["update-ref", "HEAD", &commit]).await.unwrap();
        git(repo, &["reset", "--hard", "HEAD"]).await.unwrap();
        commit
    }

    async fn init_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().to_str().unwrap();
        for args in [
            vec!["init", "-b", "main"],
            vec!["config", "user.email", "t@t"],
            vec!["config", "user.name", "t"],
        ] {
            git(repo, &args).await.unwrap();
        }
        tokio::fs::write(dir.path().join("a.txt"), "hello")
            .await
            .unwrap();
        plumbing_commit(repo, "init").await;
        dir
    }

    #[tokio::test]
    async fn captures_checkpoint_with_dirty_worktree() {
        let dir = init_repo().await;
        let repo = dir.path().to_str().unwrap();
        tokio::fs::write(dir.path().join("b.txt"), "uncommitted")
            .await
            .unwrap();

        let state = capture_checkpoint(repo).await.unwrap();
        assert_eq!(state.branch.as_deref(), Some("main"));
        assert!(state.head.is_some());
        // The worktree tree must contain the uncommitted file.
        let tree_listing = git(repo, &["ls-tree", "-r", &state.worktree_tree])
            .await
            .unwrap();
        assert!(tree_listing.contains("b.txt"));
        // The checkpoint commit exists under the checkpoint ref.
        let ref_name = format!("{CHECKPOINT_REF_PREFIX}{}", state.checkpoint_id);
        let resolved = git(repo, &["rev-parse", &ref_name]).await.unwrap();
        assert_eq!(resolved.trim(), state.commit);
    }

    #[tokio::test]
    async fn worktree_tree_drops_large_blobs_to_head_version() {
        let dir = init_repo().await;
        let repo = dir.path().to_str().unwrap();
        // A new >1MiB file not in HEAD must be dropped from the tree.
        tokio::fs::write(dir.path().join("big.bin"), vec![0u8; 2 * 1024 * 1024])
            .await
            .unwrap();

        let state = capture_checkpoint(repo).await.unwrap();
        let tree_listing = git(repo, &["ls-tree", "-r", &state.worktree_tree])
            .await
            .unwrap();
        assert!(!tree_listing.contains("big.bin"));
        assert!(tree_listing.contains("a.txt"));
    }

    #[tokio::test]
    async fn capture_refuses_mid_merge() {
        let dir = init_repo().await;
        let repo = dir.path().to_str().unwrap();
        let head = git(repo, &["rev-parse", "HEAD"]).await.unwrap();
        tokio::fs::write(dir.path().join(".git/MERGE_HEAD"), head)
            .await
            .unwrap();

        let err = capture_checkpoint(repo).await.unwrap_err();
        assert!(err.0.contains("git operation is in progress"));
    }

    #[tokio::test]
    async fn checkout_branch_at_head_variants() {
        let dir = init_repo().await;
        let repo = dir.path().to_str().unwrap();
        let head = git(repo, &["rev-parse", "HEAD"])
            .await
            .unwrap()
            .trim()
            .to_string();

        // Existing current branch → hard reset.
        checkout_branch_at_head(repo, "main", &head).await.unwrap();
        // New branch → created at head.
        checkout_branch_at_head(repo, "feature/x", &head)
            .await
            .unwrap();
        let branch = git(repo, &["symbolic-ref", "--short", "HEAD"])
            .await
            .unwrap();
        assert_eq!(branch.trim(), "feature/x");
    }

    #[tokio::test]
    async fn branch_status_detects_divergence_and_fast_forward() {
        let dir = init_repo().await;
        let repo = dir.path().to_str().unwrap();
        let first = git(repo, &["rev-parse", "HEAD"])
            .await
            .unwrap()
            .trim()
            .to_string();
        tokio::fs::write(dir.path().join("a.txt"), "v2")
            .await
            .unwrap();
        let second = plumbing_commit(repo, "second").await;

        // Cloud ahead of local branch → fast-forward.
        git(repo, &["reset", "--hard", &first]).await.unwrap();
        assert!(matches!(
            branch_restore_status(repo, "main", &second).await.unwrap(),
            BranchRestoreStatus::FastForward
        ));

        // Local commit not an ancestor of cloud head → diverged.
        tokio::fs::write(dir.path().join("c.txt"), "local")
            .await
            .unwrap();
        plumbing_commit(repo, "local divergence").await;
        assert!(matches!(
            branch_restore_status(repo, "main", &second).await.unwrap(),
            BranchRestoreStatus::Diverged { .. }
        ));

        assert!(matches!(
            branch_restore_status(repo, "missing-branch", &second)
                .await
                .unwrap(),
            BranchRestoreStatus::Missing
        ));
    }

    #[tokio::test]
    async fn checkpoint_event_params_roundtrip() {
        let checkpoint = GitCheckpoint {
            checkpoint_id: "c1".to_string(),
            commit: "abc".to_string(),
            checkpoint_ref: "refs/posthog-code-checkpoint/c1".to_string(),
            head_ref: Some("refs/posthog-code-handoff/head/c1".to_string()),
            head: Some("abc".to_string()),
            branch: Some("main".to_string()),
            index_tree: "t1".to_string(),
            worktree_tree: "t2".to_string(),
            timestamp: "2026-01-01T00:00:00.000Z".to_string(),
            upstream_remote: Some("origin".to_string()),
            upstream_merge_ref: Some("refs/heads/main".to_string()),
            remote_url: None,
            artifact_path: Some("path/pack".to_string()),
            index_artifact_path: Some("path/index".to_string()),
        };
        let params = checkpoint.to_event_params(&json!({"type": "cloud", "name": "sandbox"}));
        assert_eq!(params["checkpointId"], "c1");
        assert_eq!(params["device"]["type"], "cloud");
        let parsed = GitCheckpoint::from_event_params(&params).unwrap();
        assert_eq!(parsed.worktree_tree, "t2");
        assert_eq!(parsed.artifact_path.as_deref(), Some("path/pack"));
    }
}
