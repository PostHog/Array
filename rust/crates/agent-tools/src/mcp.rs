//! In-process MCP server for the signed-git local tools.
//!
//! Port of `adapters/local-tools/*` + `adapters/signed-commit-shared.ts`: one
//! general-purpose server named `posthog-code-tools` hosts the cloud-only
//! signed-git tools. The Claude CLI reaches it through `mcp_message` control
//! requests (the same channel the SDK's `createSdkMcpServer` servers use), so
//! no extra process or socket exists — this module answers JSON-RPC
//! `initialize` / `tools/list` / `tools/call` messages directly.
//!
//! Tool names, descriptions, schemas, and result texts are wire-format
//! contracts with the model prompt and the TS implementation — keep them
//! byte-identical.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::artefacts::report_commit_artefacts;
use crate::signed_git::{
    create_signed_commit, create_signed_merge, create_signed_rewrite, resolve_github_token,
    SignedCommitCtx, SignedCommitInput, SignedCommitResult, SignedMergeInput, SignedMergeResult,
    SignedRewriteInput, SANDBOX_ENV_FILE,
};

pub const LOCAL_TOOLS_MCP_NAME: &str = "posthog-code-tools";
pub const LOCAL_TOOLS_MCP_VERSION: &str = "1.0.0";

pub const SIGNED_COMMIT_TOOL_NAME: &str = "git_signed_commit";
pub const SIGNED_REWRITE_TOOL_NAME: &str = "git_signed_rewrite";
pub const SIGNED_MERGE_TOOL_NAME: &str = "git_signed_merge";

/// The qualified tool id as the model and tool guards see it.
pub fn qualified_local_tool_name(tool_name: &str) -> String {
    format!("mcp__{LOCAL_TOOLS_MCP_NAME}__{tool_name}")
}

const SIGNED_COMMIT_TOOL_DESCRIPTION: &str =
    "Create a GitHub-signed (Verified) commit on the branch. Stage files with `git add` \
     first (or pass `paths`), then call this instead of `git commit`/`git push` — those are \
     blocked because all commits must be signed. The commit is created via GitHub's API and \
     your local checkout is kept in sync. For a new branch, pass `branch` (prefixed with \
     `posthog-code/`) and the tool creates it on the remote. Refuses while a merge/rebase/\
     cherry-pick is in progress, refuses staged files that copy base-branch content into the PR \
     (to bring the base branch in, use `git_signed_merge`), and refuses when the remote branch \
     has advanced past your checkout (e.g. a CI bot pushed) — sync it first, then retry.";

const SIGNED_REWRITE_TOOL_DESCRIPTION: &str =
    "Force-update a branch with GitHub-signed (Verified) history, the signed-commit equivalent \
     of `git push --force`. First rebase locally with normal `git` (resolving conflicts and \
     finishing with `git rebase --continue`, NOT `git commit`); then call this to republish the \
     branch's commits as Verified and atomically move the remote branch onto them. Use this to \
     update an existing PR after a rebase or conflict fix. Rewrites the current branch by default. \
     Histories containing merge commits are refused — rebase (which flattens merges) first.";

const SIGNED_MERGE_TOOL_DESCRIPTION: &str =
    "Merge the base branch INTO the current PR branch as a GitHub-signed (Verified) \
     two-parent merge commit, created server-side (the API behind GitHub's \"Update branch\" \
     button). Use this to bring a PR up to date with its base — NEVER run `git merge` and \
     then `git_signed_commit`: that linearizes the merge and floods the PR with base-branch \
     changes. If GitHub reports a conflict, rebase locally (`git rebase origin/<base>`) and \
     use `git_signed_rewrite` instead.";

const CWD_ARG_COMMIT: &str = "Path to the git checkout to commit from; defaults to the session's working directory. \
     Pass this when committing to a clone outside the session cwd (e.g. a sibling repo cloned during the run). \
     Relative paths resolve against the session cwd.";
const CWD_ARG_REWRITE: &str =
    "Path to the git checkout to rewrite; defaults to the session's working directory. \
     Relative paths resolve against the session cwd.";
const CWD_ARG_MERGE: &str =
    "Path to the git checkout to merge in; defaults to the session's working directory. \
     Relative paths resolve against the session cwd.";

fn input_schema(properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#",
    })
}

/// Tool definitions in `tools/list` shape. `_meta["anthropic/alwaysLoad"]`
/// keeps the tools visible even when MCP tools are offloaded behind
/// ToolSearch (`ENABLE_TOOL_SEARCH`), mirroring the TS `alwaysLoad: true`.
pub fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": SIGNED_COMMIT_TOOL_NAME,
            "description": SIGNED_COMMIT_TOOL_DESCRIPTION,
            "inputSchema": input_schema(json!({
                "message": { "type": "string", "description": "Commit headline (first line)." },
                "body": { "type": "string", "description": "Optional extended commit body." },
                "branch": {
                    "type": "string",
                    "description": "Target branch; defaults to the current branch. Use a posthog-code/ prefix for new branches.",
                },
                "paths": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Files to stage before committing; defaults to already-staged files.",
                },
                "cwd": { "type": "string", "description": CWD_ARG_COMMIT },
            }), &["message"]),
            "_meta": { "anthropic/alwaysLoad": true },
        }),
        json!({
            "name": SIGNED_MERGE_TOOL_NAME,
            "description": SIGNED_MERGE_TOOL_DESCRIPTION,
            "inputSchema": input_schema(json!({
                "branch": {
                    "type": "string",
                    "description": "PR branch to update; defaults to the current branch.",
                },
                "base": {
                    "type": "string",
                    "description": "Branch to merge in; defaults to the repo's base branch.",
                },
                "cwd": { "type": "string", "description": CWD_ARG_MERGE },
            }), &[]),
            "_meta": { "anthropic/alwaysLoad": true },
        }),
        json!({
            "name": SIGNED_REWRITE_TOOL_NAME,
            "description": SIGNED_REWRITE_TOOL_DESCRIPTION,
            "inputSchema": input_schema(json!({
                "branch": {
                    "type": "string",
                    "description": "Branch to rewrite; defaults to the current branch.",
                },
                "onto": {
                    "type": "string",
                    "description": "Commit/ref the rewritten history sits on (e.g. origin/master). \
                         Defaults to the merge-base of the current branch with the repo's default branch.",
                },
                "cwd": { "type": "string", "description": CWD_ARG_REWRITE },
            }), &[]),
            "_meta": { "anthropic/alwaysLoad": true },
        }),
    ]
}

fn text_result(text: String) -> Value {
    json!({ "content": [{ "type": "text", "text": text }] })
}

fn error_result(text: String) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": true })
}

fn commit_list(commits: &[crate::signed_git::CommitRef]) -> String {
    commits
        .iter()
        .map(|c| format!("- {} {}", c.sha, c.url))
        .collect::<Vec<_>>()
        .join("\n")
}

fn signed_tool_success(lead: String, result: &SignedCommitResult) -> Value {
    if result.commits.is_empty() {
        // Staged content already present on the branch — idempotent no-op, not a failure.
        return text_result(format!(
            "{} already contains the staged changes — nothing to commit.",
            result.branch
        ));
    }
    text_result(format!("{lead}:\n{}", commit_list(&result.commits)))
}

/// The in-process local-tools MCP server, dispatched per session.
#[derive(Debug, Clone)]
pub struct LocalToolsServer {
    /// Session working directory; per-call `cwd` args resolve against it.
    pub cwd: PathBuf,
    pub task_id: Option<String>,
    pub base_branch: Option<String>,
    /// Overridable for tests; production uses `/tmp/agent-env`.
    pub env_file: String,
}

impl LocalToolsServer {
    pub fn new(cwd: PathBuf, task_id: Option<String>, base_branch: Option<String>) -> Self {
        Self {
            cwd,
            task_id,
            base_branch,
            env_file: SANDBOX_ENV_FILE.to_string(),
        }
    }

    /// Answers one JSON-RPC *request* (`method` + non-null `id`). Notifications
    /// never reach this — the control handler acks them with the SDK's stub
    /// response instead.
    pub async fn handle_request(&self, message: &Value) -> Value {
        let id = message.get("id").cloned().unwrap_or(Value::Null);
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        let params = message.get("params").cloned().unwrap_or_else(|| json!({}));

        let result: Result<Value, (i64, String)> = match method {
            "initialize" => Ok(self.initialize_result(&params)),
            "tools/list" => Ok(json!({ "tools": tool_definitions() })),
            "tools/call" => self.call_tool(&params).await,
            "ping" => Ok(json!({})),
            other => Err((-32601, format!("Method not found: {other}"))),
        };

        match result {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err((code, message)) => json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": code, "message": message },
            }),
        }
    }

    fn initialize_result(&self, params: &Value) -> Value {
        // Echo the client's protocol version: the CLI always requests one it
        // supports, and both ends of this channel ship together.
        let protocol_version = params
            .get("protocolVersion")
            .and_then(Value::as_str)
            .unwrap_or("2024-11-05");
        json!({
            "protocolVersion": protocol_version,
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": LOCAL_TOOLS_MCP_NAME, "version": LOCAL_TOOLS_MCP_VERSION },
        })
    }

    async fn call_tool(&self, params: &Value) -> Result<Value, (i64, String)> {
        let name = params.get("name").and_then(Value::as_str).unwrap_or("");
        let empty_args = json!({});
        let args = params.get("arguments").unwrap_or(&empty_args);

        if !matches!(
            name,
            SIGNED_COMMIT_TOOL_NAME | SIGNED_REWRITE_TOOL_NAME | SIGNED_MERGE_TOOL_NAME
        ) {
            return Err((-32602, format!("Unknown tool: {name}")));
        }

        // Resolve the token lazily (live /tmp/agent-env first, so a mid-session
        // credential refresh takes effect).
        let Some(token) = resolve_github_token(&self.env_file) else {
            return Ok(error_result(format!(
                "{name} failed: no GitHub token in env (GH_TOKEN/GITHUB_TOKEN)"
            )));
        };
        let ctx = SignedCommitCtx {
            cwd: resolve_cwd(&self.cwd, args.get("cwd").and_then(Value::as_str)),
            token,
            task_id: self.task_id.clone(),
            base_branch: self.base_branch.clone(),
        };

        let opt_str = |key: &str| -> Option<String> {
            args.get(key).and_then(Value::as_str).map(String::from)
        };

        match name {
            SIGNED_COMMIT_TOOL_NAME => {
                let Some(message) = opt_str("message").filter(|m| !m.is_empty()) else {
                    return Err((
                        -32602,
                        format!("Invalid arguments for tool {name}: `message` is required"),
                    ));
                };
                let input = SignedCommitInput {
                    message,
                    body: opt_str("body"),
                    branch: opt_str("branch"),
                    paths: args.get("paths").and_then(Value::as_array).map(|paths| {
                        paths
                            .iter()
                            .filter_map(|p| p.as_str().map(String::from))
                            .collect()
                    }),
                };
                match create_signed_commit(&ctx, &input).await {
                    Ok(result) => {
                        // The "commit hook": every pushed commit becomes a `commit`
                        // artefact on the signal reports this task is associated
                        // with. Best-effort — a failed artefact post can't fail a
                        // commit that already landed. git_signed_rewrite is
                        // intentionally not hooked (it republishes existing history).
                        report_commit_artefacts(ctx.task_id.as_deref(), &result, &input.message)
                            .await;
                        Ok(signed_tool_success(
                            format!(
                                "Created {} signed commit(s) on {}",
                                result.commits.len(),
                                result.branch
                            ),
                            &result,
                        ))
                    }
                    Err(err) => Ok(error_result(format!("{name} failed: {err}"))),
                }
            }
            SIGNED_REWRITE_TOOL_NAME => {
                let input = SignedRewriteInput {
                    branch: opt_str("branch"),
                    onto: opt_str("onto"),
                };
                match create_signed_rewrite(&ctx, &input).await {
                    Ok(result) => Ok(signed_tool_success(
                        format!(
                            "Force-updated {} with {} signed commit(s)",
                            result.branch,
                            result.commits.len()
                        ),
                        &result,
                    )),
                    Err(err) => Ok(error_result(format!("{name} failed: {err}"))),
                }
            }
            SIGNED_MERGE_TOOL_NAME => {
                let input = SignedMergeInput {
                    branch: opt_str("branch"),
                    base: opt_str("base"),
                };
                match create_signed_merge(&ctx, &input).await {
                    Ok(SignedMergeResult::UpToDate { branch, base }) => Ok(text_result(format!(
                        "{branch} is already up to date with {base} — nothing to merge."
                    ))),
                    Ok(SignedMergeResult::Merged {
                        branch,
                        base,
                        commit,
                        local_sync_warning,
                    }) => {
                        let mut lines = vec![
                            format!("Merged {base} into {branch}:"),
                            format!("- {} {}", commit.sha, commit.url),
                        ];
                        if let Some(warning) = local_sync_warning {
                            lines.push(format!("Warning: {warning}"));
                        }
                        Ok(text_result(lines.join("\n")))
                    }
                    Err(err) => Ok(error_result(format!("{name} failed: {err}"))),
                }
            }
            _ => unreachable!(),
        }
    }
}

fn resolve_cwd(session_cwd: &Path, arg_cwd: Option<&str>) -> PathBuf {
    match arg_cwd {
        None => session_cwd.to_path_buf(),
        Some(arg) => {
            let arg_path = Path::new(arg);
            if arg_path.is_absolute() {
                arg_path.to_path_buf()
            } else {
                session_cwd.join(arg_path)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lists_all_three_signed_git_tools_with_always_load() {
        let server = LocalToolsServer::new(PathBuf::from("/tmp"), None, None);
        let response = server
            .handle_request(&json!({
                "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {},
            }))
            .await;
        let tools = response["result"]["tools"].as_array().unwrap();
        let names: Vec<&str> = tools.iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(
            names,
            vec![
                "git_signed_commit",
                "git_signed_merge",
                "git_signed_rewrite"
            ]
        );
        for tool in tools {
            assert_eq!(tool["_meta"]["anthropic/alwaysLoad"], true);
            assert_eq!(tool["inputSchema"]["type"], "object");
        }
        assert_eq!(tools[0]["inputSchema"]["required"], json!(["message"]));
    }

    #[tokio::test]
    async fn initialize_echoes_protocol_version() {
        let server = LocalToolsServer::new(PathBuf::from("/tmp"), None, None);
        let response = server
            .handle_request(&json!({
                "jsonrpc": "2.0", "id": 7, "method": "initialize",
                "params": { "protocolVersion": "2025-06-18", "capabilities": {} },
            }))
            .await;
        assert_eq!(response["result"]["protocolVersion"], "2025-06-18");
        assert_eq!(
            response["result"]["serverInfo"]["name"],
            LOCAL_TOOLS_MCP_NAME
        );
        assert_eq!(response["id"], 7);
    }

    #[tokio::test]
    async fn missing_token_returns_tool_error_result() {
        let server = LocalToolsServer {
            cwd: PathBuf::from("/tmp"),
            task_id: None,
            base_branch: None,
            env_file: "/nonexistent/agent-env".to_string(),
        };
        // Clear both token vars for this process if present so the fallback
        // env read cannot find one.
        std::env::remove_var("GH_TOKEN");
        std::env::remove_var("GITHUB_TOKEN");
        let response = server
            .handle_request(&json!({
                "jsonrpc": "2.0", "id": 2, "method": "tools/call",
                "params": { "name": "git_signed_commit", "arguments": { "message": "feat: x" } },
            }))
            .await;
        assert_eq!(response["result"]["isError"], true);
        let text = response["result"]["content"][0]["text"].as_str().unwrap();
        assert_eq!(
            text,
            "git_signed_commit failed: no GitHub token in env (GH_TOKEN/GITHUB_TOKEN)"
        );
    }

    #[tokio::test]
    async fn unknown_method_and_tool_return_jsonrpc_errors() {
        let server = LocalToolsServer::new(PathBuf::from("/tmp"), None, None);
        let response = server
            .handle_request(&json!({
                "jsonrpc": "2.0", "id": 3, "method": "resources/list", "params": {},
            }))
            .await;
        assert_eq!(response["error"]["code"], -32601);

        let response = server
            .handle_request(&json!({
                "jsonrpc": "2.0", "id": 4, "method": "tools/call",
                "params": { "name": "nope", "arguments": {} },
            }))
            .await;
        assert_eq!(response["error"]["code"], -32602);
    }

    #[test]
    fn qualified_names_match_ts() {
        assert_eq!(
            qualified_local_tool_name(SIGNED_COMMIT_TOOL_NAME),
            "mcp__posthog-code-tools__git_signed_commit"
        );
    }
}
