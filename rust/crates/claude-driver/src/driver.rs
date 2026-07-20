//! The ACP agent core: agent-server (ACP over stdio) on one side, the Claude
//! Code CLI (stream-json control protocol) on the other.
//!
//! Port of `adapters/claude/claude-agent.ts` restricted to the cloud surface
//! the Rust agent-server drives: `initialize`, `session/new`,
//! `session/prompt` (steer + turn queue), `session/cancel`,
//! `session/set_mode` / `session/set_config_option`, and the
//! `_posthog/refresh_session` ext method. The canUseTool permission relay
//! ports `permissions/permission-handlers.ts`; the hook chain ports the
//! subagent rewrite, signed-commit guard, task hooks, and the PostToolUse
//! toolResponse reporting from `hooks.ts` (which the agent-server's
//! checkpoint trigger depends on).

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use posthog_acp::{
    client_methods, ext, methods, IncomingHandler, Peer, RpcError, PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use tokio::sync::{mpsc, oneshot};

use crate::cli::{
    spawn_cli, CliSessionOptions, SidecarConfig, DEFAULT_MODEL, LOCAL_TOOLS_MCP_NAME,
};
use crate::convert::{
    convert_result, tool_info, tool_update_from_edit_response, Converter, Outgoing,
};
use crate::instructions::APPENDED_INSTRUCTIONS;
use crate::prompt::{prompt_to_claude, user_message_updates};
use crate::transport::{CliTransport, ControlHandler};
use posthog_agent_tools::mcp::LocalToolsServer;

const SESSION_ENDED_MESSAGE: &str =
    "The Claude Code process for this session has ended. Start a new session to continue.";

pub const CODE_EXECUTION_MODES: [&str; 5] = [
    "default",
    "auto",
    "acceptEdits",
    "bypassPermissions",
    "plan",
];

// Hook callback ids registered with the CLI at initialize.
const HOOK_PRE_TOOL_USE: &str = "hook_pre_tool_use";
const HOOK_POST_TOOL_USE: &str = "hook_post_tool_use";
const HOOK_TASK: &str = "hook_task";

// ---------------------------------------------------------------------------
// Mode-based tool gating (tools.ts)

const READ_TOOLS: [&str; 2] = ["Read", "NotebookRead"];
const WRITE_TOOLS: [&str; 3] = ["Edit", "Write", "NotebookEdit"];
const BASH_TOOLS: [&str; 3] = ["Bash", "BashOutput", "KillShell"];
const SEARCH_TOOLS: [&str; 3] = ["Glob", "Grep", "LS"];
const WEB_TOOLS: [&str; 2] = ["WebSearch", "WebFetch"];
const AGENT_TOOLS: [&str; 6] = [
    "Task",
    "Agent",
    "TaskCreate",
    "TaskUpdate",
    "TaskGet",
    "TaskList",
];

fn in_base_allowed(tool: &str) -> bool {
    READ_TOOLS.contains(&tool)
        || SEARCH_TOOLS.contains(&tool)
        || WEB_TOOLS.contains(&tool)
        || AGENT_TOOLS.contains(&tool)
}

pub fn is_tool_allowed_for_mode(tool: &str, mode: &str) -> bool {
    match mode {
        "bypassPermissions" => true,
        "auto" => {
            in_base_allowed(tool) || WRITE_TOOLS.contains(&tool) || BASH_TOOLS.contains(&tool)
        }
        "acceptEdits" => in_base_allowed(tool) || WRITE_TOOLS.contains(&tool),
        "default" | "plan" => in_base_allowed(tool),
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Git guard (hooks.ts blocksUnsignedGit + git-command.ts gitSubcommand)

const GIT_VALUE_FLAGS: [&str; 6] = [
    "-C",
    "-c",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--exec-path",
];

/// Returns the git subcommand of a single shell segment (e.g. "status" for
/// `git -C repo status`), or None when the segment isn't a git invocation.
/// A leading path is stripped so `/usr/bin/git` is still recognised as git.
pub fn git_subcommand(segment: &str) -> Option<&str> {
    let mut tokens = segment.split_whitespace();
    let head = tokens.next()?;
    if head.rsplit('/').next() != Some("git") {
        return None;
    }
    let mut skip_next = false;
    for tok in tokens {
        if skip_next {
            skip_next = false;
            continue;
        }
        if GIT_VALUE_FLAGS.contains(&tok) {
            skip_next = true;
            continue;
        }
        if tok.starts_with('-') {
            continue;
        }
        return Some(tok);
    }
    None
}

/// True when any top-level shell segment is a direct `git commit`/`git push`.
/// Command substitution escapes this — the sandbox git PATH shim is the
/// authoritative backstop; this hook is a fast in-band deny with guidance.
pub fn blocks_unsigned_git(command: &str) -> bool {
    if !command.contains("git") {
        return false;
    }
    command
        .split("&&")
        .flat_map(|part| part.split("||"))
        .flat_map(|part| part.split([';', '\n', '|']))
        .any(|segment| matches!(git_subcommand(segment), Some("commit") | Some("push")))
}

fn signed_commit_guard_reason() -> String {
    format!(
        "Commits must be signed: `git commit` and `git push` are disabled here. \
         Stage changes with `git add`, then call the `git_signed_commit` tool \
         (mcp__{LOCAL_TOOLS_MCP_NAME}__git_signed_commit) with a `message` to create a signed \
         commit on the branch."
    )
}

// ---------------------------------------------------------------------------
// Plan-mode helpers (plan/utils.ts)

fn claude_plans_dir() -> PathBuf {
    let config_dir = std::env::var("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
            Path::new(&home).join(".claude")
        });
    config_dir.join("plans")
}

fn is_claude_plan_file_path(file_path: Option<&str>) -> bool {
    let Some(file_path) = file_path else {
        return false;
    };
    let plans = claude_plans_dir();
    let path = Path::new(file_path);
    path == plans || path.starts_with(&plans)
}

/// `isPlanReady`: at least 40 chars and a markdown heading somewhere.
pub fn is_plan_ready(plan: &str) -> bool {
    let trimmed = plan.trim();
    if trimmed.len() < 40 {
        return false;
    }
    trimmed.lines().any(|line| {
        let hashes = line.chars().take_while(|c| *c == '#').count();
        if hashes == 0 || hashes > 6 {
            return false;
        }
        let rest = &line[hashes..];
        rest.starts_with(char::is_whitespace) && !rest.trim_start().is_empty()
    })
}

// ---------------------------------------------------------------------------
// Domain allowlist (permission-handlers.ts)

fn extract_domain_from_url(url: &str) -> Option<String> {
    let rest = url.split_once("://").map(|(_, rest)| rest)?;
    let host_port = rest.split(['/', '?', '#']).next()?;
    let host = host_port
        .rsplit_once('@')
        .map(|(_, host)| host)
        .unwrap_or(host_port);
    let host = host.split(':').next()?.to_string();
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

fn is_domain_allowed(hostname: &str, allowed_domains: &[String]) -> bool {
    allowed_domains.iter().any(|pattern| {
        if let Some(suffix) = pattern.strip_prefix("*.") {
            // "*.example.com" matches "example.com" and any subdomain.
            hostname == suffix || hostname.ends_with(&pattern[1..])
        } else {
            hostname == pattern
        }
    })
}

// ---------------------------------------------------------------------------
// PostHog exec destructive sub-tool gate (posthog-exec-gate.ts)

fn is_posthog_exec_tool(tool_name: &str) -> bool {
    let Some(rest) = tool_name.strip_prefix("mcp__posthog") else {
        return false;
    };
    let Some(middle) = rest.strip_suffix("__exec") else {
        return false;
    };
    // Middle is empty ("mcp__posthog__exec") or `_suffix` segments.
    middle.is_empty() || (middle.starts_with('_') && !middle.contains("__"))
}

fn extract_posthog_sub_tool(tool_input: &Value) -> Option<String> {
    let command = tool_input.get("command")?.as_str()?;
    let trimmed = command.trim_start();
    let rest = trimmed.strip_prefix("call")?;
    if !rest.starts_with(char::is_whitespace) {
        return None;
    }
    let mut tokens = rest.split_whitespace();
    let mut tok = tokens.next()?;
    if tok == "--json" {
        tok = tokens.next()?;
    }
    if tok
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        Some(tok.to_string())
    } else {
        None
    }
}

fn is_posthog_destructive_sub_tool(sub_tool: &str) -> bool {
    // /(^|-)(partial-update|update|delete|destroy)(-|$)/i — wrap in hyphens so
    // "start/end of string" and "hyphen boundary" collapse to one check.
    let wrapped = format!("-{}-", sub_tool.to_lowercase());
    ["partial-update", "update", "delete", "destroy"]
        .iter()
        .any(|verb| wrapped.contains(&format!("-{verb}-")))
}

// ---------------------------------------------------------------------------
// Permission options (permissions/permission-options.ts)

fn permission_options(allow_always_label: &str) -> Value {
    json!([
        { "kind": "allow_once", "name": "Yes", "optionId": "allow" },
        { "kind": "allow_always", "name": allow_always_label, "optionId": "allow_always" },
        {
            "kind": "reject_once",
            "name": "No, and tell the agent what to do differently",
            "optionId": "reject",
            "_meta": { "customInput": true },
        },
    ])
}

fn build_permission_options(
    tool_name: &str,
    tool_input: &Value,
    repo_root: Option<&str>,
    suggestions: Option<&Value>,
) -> Value {
    if BASH_TOOLS.contains(&tool_name) {
        let rule_content: Option<String> = suggestions
            .and_then(Value::as_array)
            .and_then(|updates| {
                updates
                    .iter()
                    .filter_map(|update| update.get("rules").and_then(Value::as_array))
                    .flatten()
                    .find(|rule| {
                        rule.get("toolName").and_then(Value::as_str) == Some("Bash")
                            && rule.get("ruleContent").and_then(Value::as_str).is_some()
                    })
                    .and_then(|rule| rule.get("ruleContent").and_then(Value::as_str))
                    .map(str::to_string)
            })
            .map(|content| {
                content
                    .trim_end_matches('*')
                    .trim_end_matches(':')
                    .to_string()
            });

        let command = tool_input.get("command").and_then(Value::as_str);
        let cmd_name = command
            .and_then(|c| c.split_whitespace().next())
            .unwrap_or("this command");
        let scope_label = repo_root.map(|r| format!(" in {r}")).unwrap_or_default();
        let label = rule_content.unwrap_or_else(|| format!("`{cmd_name}` commands"));
        return permission_options(&format!(
            "Yes, and don't ask again for {label}{scope_label}"
        ));
    }

    if tool_name == "BashOutput" {
        return permission_options("Yes, allow all background process reads");
    }
    if tool_name == "KillShell" {
        return permission_options("Yes, allow killing processes");
    }
    if WRITE_TOOLS.contains(&tool_name) {
        return permission_options("Yes, allow all edits during this session");
    }
    if READ_TOOLS.contains(&tool_name) {
        return permission_options("Yes, allow all reads during this session");
    }
    if SEARCH_TOOLS.contains(&tool_name) {
        return permission_options("Yes, allow all searches during this session");
    }
    if tool_name == "WebFetch" {
        let domain = tool_input
            .get("url")
            .and_then(Value::as_str)
            .and_then(extract_domain_from_url);
        return permission_options(&match domain {
            Some(domain) => format!("Yes, allow all fetches from {domain}"),
            None => "Yes, allow all fetches".to_string(),
        });
    }
    if tool_name == "WebSearch" {
        return permission_options("Yes, allow all web searches");
    }
    if tool_name == "Task" {
        return permission_options("Yes, allow all sub-tasks");
    }
    if matches!(
        tool_name,
        "TaskCreate" | "TaskUpdate" | "TaskGet" | "TaskList"
    ) {
        return permission_options("Yes, allow all task updates");
    }
    permission_options("Yes, always allow")
}

fn allow_bypass() -> bool {
    let is_root = unsafe { libc::geteuid() } == 0;
    !is_root || std::env::var("IS_SANDBOX").is_ok()
}

fn continue_label(mode: &str) -> Option<&'static str> {
    match mode {
        "auto" => Some("Yes, continue in \"auto\" mode"),
        "acceptEdits" => Some("Yes, continue auto-accepting edits"),
        "default" => Some("Yes, continue manually approving edits"),
        "bypassPermissions" => Some("Yes, continue bypassing all permissions"),
        _ => None,
    }
}

fn build_exit_plan_mode_options(previous_mode: Option<&str>) -> Value {
    let mut options: Vec<Value> = Vec::new();
    if allow_bypass() {
        options.push(json!({
            "kind": "allow_always",
            "name": "Yes, bypass all permissions",
            "optionId": "bypassPermissions",
        }));
    }
    options.push(json!({
        "kind": "allow_always",
        "name": "Yes, and use \"auto\" mode",
        "optionId": "auto",
    }));
    options.push(json!({
        "kind": "allow_always",
        "name": "Yes, and auto-accept edits",
        "optionId": "acceptEdits",
    }));
    options.push(json!({
        "kind": "allow_once",
        "name": "Yes, and manually approve edits",
        "optionId": "default",
    }));

    if let Some(previous_mode) = previous_mode {
        if let Some(index) = options
            .iter()
            .position(|o| o.get("optionId").and_then(Value::as_str) == Some(previous_mode))
        {
            let mut previous = options.remove(index);
            if let Some(label) = continue_label(previous_mode) {
                previous["name"] = json!(label);
            }
            options.insert(0, previous);
        }
    }

    options.push(json!({
        "kind": "reject_once",
        "name": "No, and tell the agent what to do differently",
        "optionId": "reject_with_feedback",
        "_meta": { "customInput": true },
    }));
    json!(options)
}

/// `normalizeAskUserQuestionInput`: multi-question input or the single
/// question shorthand.
fn normalize_questions(input: &Value) -> Option<Vec<Value>> {
    if let Some(questions) = input.get("questions").and_then(Value::as_array) {
        if !questions.is_empty() {
            return Some(questions.clone());
        }
    }
    let question = input.get("question").and_then(Value::as_str)?;
    let mut item = json!({
        "question": question,
        "options": input.get("options").cloned().unwrap_or_else(|| json!([])),
    });
    if let Some(header) = input.get("header") {
        item["header"] = header.clone();
    }
    if let Some(multi) = input.get("multiSelect") {
        item["multiSelect"] = multi.clone();
    }
    Some(vec![item])
}

const OPTION_PREFIX: &str = "option_";

fn build_question_options(question: &Value) -> Value {
    let options = question
        .get("options")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mapped: Vec<Value> = options
        .iter()
        .enumerate()
        .map(|(idx, opt)| {
            let mut entry = json!({
                "kind": "allow_once",
                "name": opt.get("label").cloned().unwrap_or(Value::Null),
                "optionId": format!("{OPTION_PREFIX}{idx}"),
            });
            if let Some(description) = opt.get("description").and_then(Value::as_str) {
                entry["_meta"] = json!({ "description": description });
            }
            entry
        })
        .collect();
    json!(mapped)
}

// ---------------------------------------------------------------------------
// PH_EXPLORE subagent (session/options.ts)

fn ph_explore_agent() -> Value {
    json!({
        "description": "Fast agent for exploring and understanding codebases. Use this when you need to find files by pattern (eg. \"src/components/**/*.tsx\"), search for code or keywords (eg. \"where is the auth middleware?\"), or answer questions about how the codebase works (eg. \"how does the session service handle reconnects?\"). When calling this agent, specify a thoroughness level: \"quick\" for targeted lookups, \"medium\" for broader exploration, or \"very thorough\" for comprehensive analysis across multiple locations.",
        "model": "sonnet",
        "prompt": "You are a fast, read-only codebase exploration agent.\n\nYour job is to find files, search code, read the most relevant sources, and report findings clearly.\n\nRules:\n- Never create, modify, delete, move, or copy files.\n- Never use shell redirection or any command that changes system state.\n- Use Glob for broad file pattern matching.\n- Use Grep for searching file contents.\n- Use Read when you know the exact file path to inspect.\n- Use Bash only for safe read-only commands like ls, git status, git log, git diff, find, cat, head, and tail.\n- Adapt your search approach based on the thoroughness level specified by the caller.\n- Return file paths as absolute paths in your final response.\n- Avoid using emojis.\n- Wherever possible, spawn multiple parallel tool calls for grepping and reading files.\n- Search efficiently, then read only the most relevant files.\n- Return findings directly in your final response — do not create files.",
        "tools": [
            "Bash", "Glob", "Grep", "Read", "WebFetch", "WebSearch", "NotebookRead",
            "TaskCreate", "TaskUpdate", "TaskGet", "TaskList",
        ],
    })
}

/// `createSubagentRewriteHook`: aliases callers shouldn't know about.
fn subagent_rewrite(subagent_type: &str) -> Option<&'static str> {
    match subagent_type {
        "Explore" => Some("ph-explore"),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Turn queue

struct Turn {
    params: Value,
    resolve: oneshot::Sender<Result<Value, RpcError>>,
}

#[derive(Default)]
struct TurnState {
    /// Resolver for the turn whose user message is with the CLI right now.
    active: Option<oneshot::Sender<Result<Value, RpcError>>>,
    queued: VecDeque<Turn>,
}

impl TurnState {
    fn has_in_flight(&self) -> bool {
        self.active.is_some() || !self.queued.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Session state

struct ClaudeSession {
    acp_session_id: String,
    cwd: String,
    transport: Mutex<CliTransport>,
    child: Mutex<Option<tokio::process::Child>>,
    turns: Mutex<TurnState>,
    converter: Mutex<Converter>,
    permission_mode: Mutex<String>,
    mode_before_plan: Mutex<Option<String>>,
    /// Plan captured from Write into the plans dir (plan-file exception).
    last_plan_content: Mutex<Option<String>>,
    /// Last contiguous run of agent_message_chunk text (ExitPlanMode fallback,
    /// the port of `getLatestAssistantText`).
    latest_assistant_text: Mutex<String>,
    last_was_message_chunk: AtomicBool,
    cancelled: AtomicBool,
    query_closed: AtomicBool,
    /// Set across a refresh_session respawn so the retiring consumer's EOF
    /// doesn't fail turns or mark the session closed.
    refreshing: AtomicBool,
    sdk_session_id: Mutex<Option<String>>,
    local_tools: LocalToolsServer,
    allowed_domains: Option<Vec<String>>,
    /// Spawn options retained so refresh_session can respawn with `--resume`.
    cli_options: Mutex<CliSessionOptions>,
}

impl ClaudeSession {
    fn mode(&self) -> String {
        self.permission_mode.lock().expect("mode lock").clone()
    }
}

// ---------------------------------------------------------------------------
// The driver

pub struct Driver {
    peer: OnceLock<Peer>,
    sidecar: SidecarConfig,
    session: Mutex<Option<Arc<ClaudeSession>>>,
}

impl Driver {
    pub fn new(sidecar: SidecarConfig) -> Arc<Self> {
        Arc::new(Self {
            peer: OnceLock::new(),
            sidecar,
            session: Mutex::new(None),
        })
    }

    /// Run the agent over the given stdio; resolves when the client closes
    /// the connection.
    pub async fn run<R, W>(self: &Arc<Self>, read: R, write: W)
    where
        R: tokio::io::AsyncRead + Unpin + Send + 'static,
        W: tokio::io::AsyncWrite + Unpin + Send + 'static,
    {
        let handler = Arc::new(AgentHandler {
            driver: Arc::clone(self),
        });
        let (peer, handle) = Peer::spawn(read, write, handler, None);
        let _ = self.peer.set(peer);
        let _ = handle.reader.await;
    }

    fn peer(&self) -> &Peer {
        self.peer.get().expect("peer initialized in run()")
    }

    fn current_session(&self) -> Result<Arc<ClaudeSession>, RpcError> {
        self.session
            .lock()
            .expect("session lock")
            .clone()
            .ok_or_else(|| RpcError::new(-32602, "No active session"))
    }

    fn session_update(&self, session: &ClaudeSession, update: Value) {
        self.track_latest_assistant_text(session, &update);
        self.peer().notify(
            client_methods::SESSION_UPDATE,
            json!({ "sessionId": session.acp_session_id, "update": update }),
        );
    }

    fn emit_outgoing(&self, session: &ClaudeSession, outgoing: Outgoing) {
        match outgoing {
            Outgoing::Update(update) => self.session_update(session, update),
            Outgoing::Ext(method, mut params) => {
                params["sessionId"] = json!(session.acp_session_id);
                self.peer().notify(method, params);
            }
        }
    }

    /// Rolling "last contiguous run of assistant text" for the ExitPlanMode
    /// plan fallback.
    fn track_latest_assistant_text(&self, session: &ClaudeSession, update: &Value) {
        let is_chunk =
            update.get("sessionUpdate").and_then(Value::as_str) == Some("agent_message_chunk");
        if is_chunk {
            if let Some(text) = update.pointer("/content/text").and_then(Value::as_str) {
                let mut latest = session
                    .latest_assistant_text
                    .lock()
                    .expect("assistant text lock");
                if session.last_was_message_chunk.swap(true, Ordering::SeqCst) {
                    latest.push_str(text);
                } else {
                    *latest = text.to_string();
                }
            }
        } else {
            session
                .last_was_message_chunk
                .store(false, Ordering::SeqCst);
        }
    }

    // -- session/new ---------------------------------------------------------

    async fn new_session(self: &Arc<Self>, params: Value) -> Result<Value, RpcError> {
        self.create_session(params, None).await
    }

    /// `resumeSession` (`_posthog/session/resume`): continue the prior ACP
    /// session under its own id — the CLI reloads the conversation from the
    /// session JSONL via `--resume`, and the plan panel is rebuilt from the
    /// same transcript.
    async fn resume_session(self: &Arc<Self>, params: Value) -> Result<Value, RpcError> {
        let resume_id = params
            .get("sessionId")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| RpcError::new(-32602, "session/resume requires sessionId"))?
            .to_string();
        let response = self.create_session(params, Some(resume_id.clone())).await?;

        // rehydrateTaskStateFromJsonl: best-effort — a missing or unreadable
        // transcript must not block the resume.
        if let Some(session) = self.session.lock().expect("session lock").clone() {
            let jsonl_path = posthog_agent_tools::session_jsonl::get_session_jsonl_path(
                &resume_id,
                &session.cwd,
            );
            let messages = posthog_agent_tools::session_jsonl::read_session_messages(&jsonl_path);
            let plan_update = session
                .converter
                .lock()
                .expect("converter lock")
                .rehydrate_task_state(&messages);
            if let Some(update) = plan_update {
                self.session_update(&session, update);
            }
        }
        Ok(response)
    }

    async fn create_session(
        self: &Arc<Self>,
        params: Value,
        resume: Option<String>,
    ) -> Result<Value, RpcError> {
        let cwd = params
            .get("cwd")
            .and_then(Value::as_str)
            .ok_or_else(|| RpcError::new(-32602, "session/new requires cwd"))?
            .to_string();
        if !Path::new(&cwd).is_dir() {
            return Err(RpcError::new(-32602, format!("cwd does not exist: {cwd}")));
        }
        let meta = params.get("_meta").cloned().unwrap_or_else(|| json!({}));

        // A resumed session keeps the prior session id (the CLI reloads its
        // JSONL under that id); a fresh one mints a new id.
        let session_id = resume
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let permission_mode = meta
            .get("permissionMode")
            .and_then(Value::as_str)
            .filter(|m| CODE_EXECUTION_MODES.contains(m))
            .unwrap_or("default")
            .to_string();
        let model = meta
            .get("model")
            .and_then(Value::as_str)
            .filter(|m| !m.is_empty())
            .unwrap_or(DEFAULT_MODEL)
            .to_string();
        let claude_options = meta.pointer("/claudeCode/options");
        let effort = claude_options
            .and_then(|o| o.get("effort"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let plugins: Vec<String> = claude_options
            .and_then(|o| o.get("plugins"))
            .and_then(Value::as_array)
            .map(|plugins| {
                plugins
                    .iter()
                    .filter_map(|p| p.get("path").and_then(Value::as_str))
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let json_schema = meta.get("jsonSchema").filter(|s| !s.is_null()).cloned();
        let allowed_domains: Option<Vec<String>> = meta
            .get("allowedDomains")
            .and_then(Value::as_array)
            .map(|domains| {
                domains
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            });
        // resolveTaskId: meta.taskId ?? meta.persistence.taskId
        let task_id = meta
            .get("taskId")
            .and_then(Value::as_str)
            .or_else(|| meta.pointer("/persistence/taskId").and_then(Value::as_str))
            .map(str::to_string);
        let base_branch = meta
            .get("baseBranch")
            .and_then(Value::as_str)
            .map(str::to_string);

        let cli_options = CliSessionOptions {
            cwd: cwd.clone(),
            session_id: session_id.clone(),
            resume,
            permission_mode: permission_mode.clone(),
            model,
            json_schema: json_schema.clone(),
            effort,
            plugins,
            mcp_servers: params
                .get("mcpServers")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        };

        let session = Arc::new(ClaudeSession {
            acp_session_id: session_id.clone(),
            cwd: cwd.clone(),
            // Detached placeholder: the control handler needs the session Arc,
            // so the real spawn happens in respawn_cli right below.
            transport: Mutex::new(CliTransport::detached().0),
            child: Mutex::new(None),
            turns: Mutex::new(TurnState::default()),
            converter: Mutex::new(Converter::new(&cwd)),
            permission_mode: Mutex::new(permission_mode),
            mode_before_plan: Mutex::new(None),
            last_plan_content: Mutex::new(None),
            latest_assistant_text: Mutex::new(String::new()),
            last_was_message_chunk: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
            query_closed: AtomicBool::new(false),
            refreshing: AtomicBool::new(false),
            sdk_session_id: Mutex::new(None),
            local_tools: LocalToolsServer::new(PathBuf::from(&cwd), task_id, base_branch),
            allowed_domains,
            cli_options: Mutex::new(cli_options),
        });
        self.respawn_cli(&session, &meta, true).await?;

        *self.session.lock().expect("session lock") = Some(Arc::clone(&session));
        Ok(json!({ "sessionId": session_id }))
    }

    /// Spawn (or respawn) the CLI for a session and wire the control handler,
    /// consumer, and initialize handshake. On respawn, `initial` is false and
    /// the retiring process is killed first.
    async fn respawn_cli(
        self: &Arc<Self>,
        session: &Arc<ClaudeSession>,
        meta: &Value,
        initial: bool,
    ) -> Result<(), RpcError> {
        if !initial {
            session.refreshing.store(true, Ordering::SeqCst);
            if let Some(mut child) = session.child.lock().expect("child lock").take() {
                let _ = child.start_kill();
            }
        }

        let options = session
            .cli_options
            .lock()
            .expect("cli options lock")
            .clone();
        let spawned = spawn_cli(&options, self.sidecar.gateway_env.as_ref())
            .map_err(|err| RpcError::internal(format!("Failed to spawn Claude Code: {err}")))?;

        let control = Arc::new(SessionControlHandler {
            driver: Arc::clone(self),
            session: Arc::downgrade(session),
        });
        let (transport, msg_rx) = CliTransport::spawn(spawned.stdin, spawned.stdout, control);
        *session.child.lock().expect("child lock") = Some(spawned.child);
        *session.transport.lock().expect("transport lock") = transport.clone();
        self.spawn_consumer(Arc::clone(session), msg_rx);
        session.refreshing.store(false, Ordering::SeqCst);

        // The SDK initialize handshake: hooks, in-process MCP servers, system
        // prompt, subagents.
        let (system_prompt, append_system_prompt) = build_system_prompt_fields(meta);
        let mut init = json!({
            "subtype": "initialize",
            "hooks": {
                "PreToolUse": [{ "hookCallbackIds": [HOOK_PRE_TOOL_USE] }],
                "PostToolUse": [{ "hookCallbackIds": [HOOK_POST_TOOL_USE] }],
                "TaskCreated": [{ "hookCallbackIds": [HOOK_TASK] }],
                "TaskCompleted": [{ "hookCallbackIds": [HOOK_TASK] }],
            },
            "sdkMcpServers": [LOCAL_TOOLS_MCP_NAME],
            "agents": { "ph-explore": ph_explore_agent() },
        });
        if let Some(system_prompt) = system_prompt {
            init["systemPrompt"] = system_prompt;
        }
        if let Some(append) = append_system_prompt {
            init["appendSystemPrompt"] = json!(append);
        }
        if let Some(schema) = &options.json_schema {
            init["jsonSchema"] = schema.clone();
        }

        transport
            .control_request(init)
            .await
            .map_err(|err| RpcError::internal(format!("Claude Code initialize failed: {err}")))?;
        Ok(())
    }

    fn spawn_consumer(
        self: &Arc<Self>,
        session: Arc<ClaudeSession>,
        mut msg_rx: mpsc::UnboundedReceiver<Value>,
    ) {
        let driver = Arc::clone(self);
        tokio::spawn(async move {
            while let Some(message) = msg_rx.recv().await {
                driver.handle_cli_message(&session, message);
            }
            // Planned respawn: the retiring stream's EOF is not a failure.
            if session.refreshing.load(Ordering::SeqCst) {
                return;
            }
            session.query_closed.store(true, Ordering::SeqCst);
            let mut turns = session.turns.lock().expect("turns lock");
            if let Some(active) = turns.active.take() {
                let _ = active.send(Err(RpcError::internal(SESSION_ENDED_MESSAGE)));
            }
            for turn in turns.queued.drain(..) {
                let _ = turn
                    .resolve
                    .send(Err(RpcError::internal(SESSION_ENDED_MESSAGE)));
            }
        });
    }

    fn handle_cli_message(self: &Arc<Self>, session: &Arc<ClaudeSession>, message: Value) {
        match message.get("type").and_then(Value::as_str) {
            Some("result") => self.handle_result_message(session, &message),
            Some("system") if message.get("subtype").and_then(Value::as_str) == Some("init") => {
                if let Some(sdk_session_id) = message.get("session_id").and_then(Value::as_str) {
                    *session.sdk_session_id.lock().expect("sdk session lock") =
                        Some(sdk_session_id.to_string());
                    self.peer().notify(
                        ext::SDK_SESSION,
                        json!({
                            "sessionId": session.acp_session_id,
                            "sdkSessionId": sdk_session_id,
                        }),
                    );
                }
            }
            _ => {
                let outgoings = {
                    let mut converter = session.converter.lock().expect("converter lock");
                    converter.convert(&message)
                };
                for outgoing in outgoings {
                    self.emit_outgoing(session, outgoing);
                }
            }
        }
    }

    fn handle_result_message(self: &Arc<Self>, session: &Arc<ClaudeSession>, message: &Value) {
        // Usage first, so clients have fresh numbers when the turn settles.
        if let Some(usage) = message.get("usage") {
            let read = |key: &str| usage.get(key).and_then(Value::as_u64).unwrap_or(0);
            self.peer().notify(
                ext::USAGE_UPDATE,
                json!({
                    "sessionId": session.acp_session_id,
                    "used": {
                        "inputTokens": read("input_tokens"),
                        "outputTokens": read("output_tokens"),
                        "cachedReadTokens": read("cache_read_input_tokens"),
                        "cachedWriteTokens": read("cache_creation_input_tokens"),
                    },
                    "cost": message.get("total_cost_usd").cloned().unwrap_or(Value::Null),
                }),
            );
        }

        if message.get("subtype").and_then(Value::as_str) == Some("success") {
            if let Some(output) = message.get("structured_output").filter(|o| !o.is_null()) {
                self.peer().notify(
                    ext::STRUCTURED_OUTPUT,
                    json!({ "sessionId": session.acp_session_id, "output": output }),
                );
            }
        }

        let outcome = convert_result(message);
        let cancelled = session.cancelled.swap(false, Ordering::SeqCst);
        let settled: Result<Value, RpcError> = if cancelled {
            Ok(json!({ "stopReason": "cancelled" }))
        } else if let Some((error_message, data)) = outcome.error {
            Err(RpcError {
                code: -32603,
                message: error_message,
                data: Some(data),
            })
        } else {
            Ok(json!({
                "stopReason": outcome.stop_reason.unwrap_or_else(|| "end_turn".to_string()),
            }))
        };

        // Claim the next queued turn's active slot inside the same lock that
        // settles the finished one, so a racing prompt can't double-activate.
        let next_params = {
            let mut turns = session.turns.lock().expect("turns lock");
            if let Some(active) = turns.active.take() {
                let _ = active.send(settled);
            }
            match turns.queued.pop_front() {
                Some(next) => {
                    turns.active = Some(next.resolve);
                    Some(next.params)
                }
                None => None,
            }
        };
        if let Some(params) = next_params {
            self.start_turn_io(session, &params);
        }
    }

    /// The IO side of turn activation: broadcast the user message chunks and
    /// hand the SDK user message to the CLI. The caller has already claimed
    /// the active slot.
    fn start_turn_io(self: &Arc<Self>, session: &Arc<ClaudeSession>, params: &Value) {
        session.cancelled.store(false, Ordering::SeqCst);
        for update in user_message_updates(params) {
            self.session_update(session, update);
        }
        let message = prompt_to_claude(&session.acp_session_id, params);
        session
            .transport
            .lock()
            .expect("transport lock")
            .write_value(&message);
    }

    // -- session/prompt ------------------------------------------------------

    async fn prompt(self: &Arc<Self>, params: Value) -> Result<Value, RpcError> {
        let session = self.current_session()?;
        if session.query_closed.load(Ordering::SeqCst) {
            return Err(RpcError::internal(SESSION_ENDED_MESSAGE));
        }

        let is_steer = params
            .pointer("/_meta/steer")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        enum Dispatch {
            Steer,
            Activate(oneshot::Receiver<Result<Value, RpcError>>),
            Queued(oneshot::Receiver<Result<Value, RpcError>>),
        }

        let dispatch = {
            let mut turns = session.turns.lock().expect("turns lock");
            if turns.has_in_flight() && is_steer {
                Dispatch::Steer
            } else if turns.active.is_some() {
                let (tx, rx) = oneshot::channel();
                turns.queued.push_back(Turn {
                    params: params.clone(),
                    resolve: tx,
                });
                Dispatch::Queued(rx)
            } else {
                let (tx, rx) = oneshot::channel();
                turns.active = Some(tx);
                Dispatch::Activate(rx)
            }
        };

        let rx = match dispatch {
            Dispatch::Steer => {
                // Fold into the running turn (promptToClaude tagged it
                // priority "next"); the benign end_turn is ignored by clients,
                // which key off _meta.steer.
                let message = prompt_to_claude(&session.acp_session_id, &params);
                session
                    .transport
                    .lock()
                    .expect("transport lock")
                    .write_value(&message);
                for update in user_message_updates(&params) {
                    self.session_update(&session, update);
                }
                return Ok(json!({ "stopReason": "end_turn" }));
            }
            Dispatch::Activate(rx) => {
                self.start_turn_io(&session, &params);
                rx
            }
            Dispatch::Queued(rx) => rx,
        };

        match rx.await {
            Ok(result) => result,
            Err(_) => Err(RpcError::internal(SESSION_ENDED_MESSAGE)),
        }
    }

    // -- cancel / modes / refresh ---------------------------------------------

    fn cancel(self: &Arc<Self>, _params: Value) {
        let Ok(session) = self.current_session() else {
            return;
        };
        session.cancelled.store(true, Ordering::SeqCst);
        let transport = session.transport.lock().expect("transport lock").clone();
        tokio::spawn(async move {
            let _ = transport
                .control_request(json!({ "subtype": "interrupt" }))
                .await;
        });
    }

    async fn apply_session_mode(
        self: &Arc<Self>,
        session: &Arc<ClaudeSession>,
        mode: &str,
    ) -> Result<(), String> {
        if !CODE_EXECUTION_MODES.contains(&mode) {
            return Err(format!("Invalid mode: {mode}"));
        }
        let transport = session.transport.lock().expect("transport lock").clone();
        transport
            .control_request(json!({ "subtype": "set_permission_mode", "mode": mode }))
            .await
            .map_err(|err| err.to_string())?;
        *session.permission_mode.lock().expect("mode lock") = mode.to_string();
        self.session_update(
            session,
            json!({ "sessionUpdate": "current_mode_update", "currentModeId": mode }),
        );
        Ok(())
    }

    async fn set_mode(self: &Arc<Self>, params: Value) -> Result<Value, RpcError> {
        let session = self.current_session()?;
        let mode = params
            .get("modeId")
            .and_then(Value::as_str)
            .ok_or_else(|| RpcError::new(-32602, "session/set_mode requires modeId"))?;
        self.apply_session_mode(&session, mode)
            .await
            .map_err(|err| RpcError::new(-32602, err))?;
        Ok(json!({}))
    }

    async fn set_config_option(self: &Arc<Self>, params: Value) -> Result<Value, RpcError> {
        let session = self.current_session()?;
        let config_id = params.get("configId").and_then(Value::as_str);
        if config_id != Some("mode") {
            return Err(RpcError::new(
                -32602,
                format!("Unknown config option: {}", config_id.unwrap_or("<none>")),
            ));
        }
        let value = params
            .get("value")
            .and_then(Value::as_str)
            .ok_or_else(|| RpcError::new(-32602, "set_config_option requires a string value"))?;
        self.apply_session_mode(&session, value)
            .await
            .map_err(|err| RpcError::new(-32602, err))?;
        Ok(json!({ "configOptions": [] }))
    }

    /// `_posthog/refresh_session`: resume-with-new-options reinit that bakes
    /// fresh MCP servers into the spawn args, preserving conversation history
    /// via `--resume`. Only callable between turns.
    async fn refresh_session(self: &Arc<Self>, params: Value) -> Result<Value, RpcError> {
        let session = self.current_session()?;
        let Some(mcp_servers) = params.get("mcpServers") else {
            return Err(RpcError::new(
                -32602,
                "refresh_session requires at least one refreshable field (e.g. mcpServers)",
            ));
        };
        let Some(mcp_servers) = mcp_servers.as_array() else {
            return Err(RpcError::new(
                -32602,
                "refresh_session: mcpServers must be an array",
            ));
        };
        if session.turns.lock().expect("turns lock").has_in_flight() {
            return Err(RpcError::new(
                -32002,
                "Cannot refresh session while a prompt turn is in flight",
            ));
        }

        {
            let mut options = session.cli_options.lock().expect("cli options lock");
            options.mcp_servers = mcp_servers.clone();
            let resume_id = session
                .sdk_session_id
                .lock()
                .expect("sdk session lock")
                .clone()
                .unwrap_or_else(|| session.acp_session_id.clone());
            options.resume = Some(resume_id);
        }

        // Best-effort interrupt so the retiring CLI flushes session state.
        let transport = session.transport.lock().expect("transport lock").clone();
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            transport.control_request(json!({ "subtype": "interrupt" })),
        )
        .await;

        self.respawn_cli(&session, &json!({}), false).await?;
        Ok(json!({ "refreshed": true }))
    }

    // -- control requests from the CLI ----------------------------------------

    async fn handle_hook_callback(
        self: &Arc<Self>,
        session: &Arc<ClaudeSession>,
        request: &Value,
    ) -> Result<Value, String> {
        let callback_id = request
            .get("callback_id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let input = request.get("input").cloned().unwrap_or_else(|| json!({}));
        match callback_id {
            HOOK_PRE_TOOL_USE => Ok(self.pre_tool_use_hook(&input)),
            HOOK_POST_TOOL_USE => Ok(self.post_tool_use_hook(session, &input)),
            HOOK_TASK => Ok(self.task_hook(session, &input)),
            other => Err(format!("Unknown hook callback: {other}")),
        }
    }

    fn pre_tool_use_hook(&self, input: &Value) -> Value {
        if input.get("hook_event_name").and_then(Value::as_str) != Some("PreToolUse") {
            return json!({ "continue": true });
        }
        let tool_name = input.get("tool_name").and_then(Value::as_str).unwrap_or("");
        let tool_input = input.get("tool_input");

        // Subagent alias rewrite (SDK bug workaround: options.agents cannot
        // shadow built-in agent definitions, so ph-explore is registered under
        // its own name and Explore is rewritten here).
        if tool_name == "Agent" {
            if let Some(target) = tool_input
                .and_then(|i| i.get("subagent_type"))
                .and_then(Value::as_str)
                .and_then(subagent_rewrite)
            {
                let mut updated = tool_input.cloned().unwrap_or_else(|| json!({}));
                updated["subagent_type"] = json!(target);
                return json!({
                    "continue": true,
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "updatedInput": updated,
                    },
                });
            }
        }

        // Cloud signed-commit guard: raw `git commit`/`git push` never leave
        // the sandbox unsigned.
        if tool_name == "Bash" {
            if let Some(command) = tool_input
                .and_then(|i| i.get("command"))
                .and_then(Value::as_str)
            {
                if blocks_unsigned_git(command) {
                    return json!({
                        "continue": true,
                        "hookSpecificOutput": {
                            "hookEventName": "PreToolUse",
                            "permissionDecision": "deny",
                            "permissionDecisionReason": signed_commit_guard_reason(),
                        },
                    });
                }
            }
        }

        json!({ "continue": true })
    }

    /// PostToolUse: refine the tool_call with the response payload (the log +
    /// checkpoint-trigger contract: `_meta.claudeCode.toolResponse`).
    fn post_tool_use_hook(self: &Arc<Self>, session: &Arc<ClaudeSession>, input: &Value) -> Value {
        if input.get("hook_event_name").and_then(Value::as_str) != Some("PostToolUse") {
            return json!({ "continue": true });
        }
        let Some(tool_use_id) = input.get("tool_use_id").and_then(Value::as_str) else {
            return json!({ "continue": true });
        };
        let tool_name = input.get("tool_name").and_then(Value::as_str).unwrap_or("");
        let tool_response = input.get("tool_response").cloned().unwrap_or(Value::Null);

        let mut claude_code = json!({ "toolName": tool_name, "toolResponse": tool_response });
        if tool_name == "Bash" {
            if let Some(command) = input.pointer("/tool_input/command").and_then(Value::as_str) {
                claude_code["bashCommand"] = json!(command);
            }
        }

        let mut update = json!({
            "_meta": { "claudeCode": claude_code },
            "toolCallId": tool_use_id,
            "sessionUpdate": "tool_call_update",
        });
        if matches!(tool_name, "Edit" | "Write") {
            if let Some((content, locations)) = input
                .get("tool_response")
                .and_then(tool_update_from_edit_response)
            {
                update["content"] = content;
                update["locations"] = locations;
            }
        }
        self.session_update(session, update);
        json!({ "continue": true })
    }

    fn task_hook(self: &Arc<Self>, session: &Arc<ClaudeSession>, input: &Value) -> Value {
        let event = input
            .get("hook_event_name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let Some(task_id) = input.get("task_id").and_then(Value::as_str) else {
            return json!({ "continue": true });
        };
        let subject = input.get("task_subject").and_then(Value::as_str);
        let plan = {
            let mut converter = session.converter.lock().expect("converter lock");
            converter.apply_task_hook(&event, task_id, subject)
        };
        if let Some(plan) = plan {
            self.emit_outgoing(session, plan);
        }
        json!({ "continue": true })
    }

    async fn handle_mcp_message(
        &self,
        session: &Arc<ClaudeSession>,
        request: &Value,
    ) -> Result<Value, String> {
        let server_name = request
            .get("server_name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if server_name != LOCAL_TOOLS_MCP_NAME {
            return Err(format!("SDK MCP server not found: {server_name}"));
        }
        let message = request.get("message").cloned().unwrap_or_else(|| json!({}));
        let is_request = message.get("method").is_some()
            && message.get("id").map(|id| !id.is_null()).unwrap_or(false);
        if is_request {
            let response = session.local_tools.handle_request(&message).await;
            Ok(json!({ "mcp_response": response }))
        } else {
            // Notifications/responses are acked with the SDK's stub response.
            Ok(json!({ "mcp_response": { "jsonrpc": "2.0", "result": {}, "id": 0 } }))
        }
    }

    // -- canUseTool (permissions/permission-handlers.ts) ----------------------

    async fn handle_can_use_tool(
        self: &Arc<Self>,
        session: &Arc<ClaudeSession>,
        request: &Value,
    ) -> Result<Value, String> {
        let tool_name = request
            .get("tool_name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let tool_input = request.get("input").cloned().unwrap_or_else(|| json!({}));
        let tool_use_id = request.get("tool_use_id").cloned().unwrap_or(Value::Null);
        let suggestions = request.get("permission_suggestions").cloned();
        let mode = session.mode();

        let allow = |input: &Value, updated_permissions: Option<Value>| {
            let mut payload = json!({
                "behavior": "allow",
                "updatedInput": input,
                "toolUseID": tool_use_id,
            });
            if let Some(permissions) = updated_permissions {
                payload["updatedPermissions"] = permissions;
            }
            Ok(payload)
        };
        let deny = |message: String, interrupt: bool| {
            Ok(json!({
                "behavior": "deny",
                "message": message,
                "interrupt": interrupt,
                "toolUseID": tool_use_id,
            }))
        };

        // Domain allowlist for web tools.
        if let Some(allowed_domains) = session
            .allowed_domains
            .as_ref()
            .filter(|domains| !domains.is_empty())
        {
            if matches!(tool_name.as_str(), "WebFetch" | "WebSearch") {
                if let Some(url) = tool_input.get("url").and_then(Value::as_str) {
                    if let Some(hostname) = extract_domain_from_url(url) {
                        if !is_domain_allowed(&hostname, allowed_domains) {
                            let message = format!(
                                "Domain \"{hostname}\" is not in the allowed list: {}",
                                allowed_domains.join(", ")
                            );
                            self.emit_tool_denial(session, &tool_use_id, &message);
                            return deny(message, false);
                        }
                    }
                }
            }
        }

        // Destructive PostHog exec sub-tools re-prompt at sub-tool granularity.
        if tool_name.starts_with("mcp__") && is_posthog_exec_tool(&tool_name) {
            if let Some(sub_tool) = extract_posthog_sub_tool(&tool_input) {
                if is_posthog_destructive_sub_tool(&sub_tool)
                    && !matches!(mode.as_str(), "auto" | "bypassPermissions")
                {
                    return self
                        .default_permission_flow(
                            session,
                            &tool_name,
                            &tool_input,
                            &tool_use_id,
                            suggestions.as_ref(),
                        )
                        .await;
                }
            }
        }

        if is_tool_allowed_for_mode(&tool_name, &mode) {
            return allow(&tool_input, None);
        }

        if tool_name == "EnterPlanMode" {
            *session.mode_before_plan.lock().expect("plan mode lock") = Some(mode);
            self.apply_session_mode(session, "plan").await?;
            return allow(&tool_input, None);
        }
        if tool_name == "ExitPlanMode" {
            return self
                .exit_plan_mode_flow(session, &tool_input, &tool_use_id)
                .await;
        }
        if tool_name == "AskUserQuestion" {
            return self
                .ask_user_question_flow(session, &tool_input, &tool_use_id)
                .await;
        }

        // Plan-file exception: in plan mode the agent may write its plan file.
        if mode == "plan" && WRITE_TOOLS.contains(&tool_name.as_str()) {
            let file_path = tool_input.get("file_path").and_then(Value::as_str);
            if is_claude_plan_file_path(file_path) {
                if let Some(content) = tool_input.get("content").and_then(Value::as_str) {
                    *session.last_plan_content.lock().expect("plan lock") =
                        Some(content.to_string());
                }
                return allow(&tool_input, None);
            }
        }

        if mode == "plan" {
            let message = format!(
                "This tool is not available in plan mode. Write your plan \
                 to a file in {} and call ExitPlanMode when ready.",
                claude_plans_dir().display()
            );
            self.emit_tool_denial(session, &tool_use_id, &message);
            return deny(message, false);
        }

        self.default_permission_flow(
            session,
            &tool_name,
            &tool_input,
            &tool_use_id,
            suggestions.as_ref(),
        )
        .await
    }

    fn emit_tool_denial(&self, session: &ClaudeSession, tool_use_id: &Value, message: &str) {
        self.session_update(
            session,
            json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": tool_use_id,
                "status": "failed",
                "content": [{
                    "type": "content",
                    "content": { "type": "text", "text": message },
                }],
            }),
        );
    }

    async fn request_permission(
        &self,
        session: &ClaudeSession,
        options: Value,
        tool_call: Value,
    ) -> Result<Value, String> {
        self.peer()
            .request(
                client_methods::SESSION_REQUEST_PERMISSION,
                json!({
                    "sessionId": session.acp_session_id,
                    "options": options,
                    "toolCall": tool_call,
                }),
            )
            .await
            .map_err(|_| "Tool use aborted".to_string())
    }

    async fn default_permission_flow(
        self: &Arc<Self>,
        session: &Arc<ClaudeSession>,
        tool_name: &str,
        tool_input: &Value,
        tool_use_id: &Value,
        suggestions: Option<&Value>,
    ) -> Result<Value, String> {
        // The SDK can invoke canUseTool before the tool_use block streams.
        if let Some(id) = tool_use_id.as_str() {
            let pending = {
                let mut converter = session.converter.lock().expect("converter lock");
                converter.ensure_tool_call_emitted(id, tool_name, tool_input)
            };
            if let Some(update) = pending {
                self.session_update(session, update);
            }
        }

        let info = tool_info(tool_name, tool_input, &session.cwd);
        let options =
            build_permission_options(tool_name, tool_input, Some(&session.cwd), suggestions);
        let mut raw_input = tool_input.clone();
        raw_input["toolName"] = json!(tool_name);
        let mut tool_call = json!({
            "toolCallId": tool_use_id,
            "title": info.title,
            "kind": info.kind,
            "content": info.content,
            "rawInput": raw_input,
        });
        if let Some(locations) = info.locations {
            tool_call["locations"] = locations;
        }
        if tool_name.starts_with("mcp__") {
            tool_call["_meta"] = json!({ "claudeCode": { "toolName": tool_name } });
        }

        let response = self.request_permission(session, options, tool_call).await?;
        let outcome = response.pointer("/outcome/outcome").and_then(Value::as_str);
        if outcome == Some("cancelled") {
            return Err("Tool use aborted".to_string());
        }
        let option_id = response
            .pointer("/outcome/optionId")
            .and_then(Value::as_str);
        if outcome == Some("selected") && matches!(option_id, Some("allow") | Some("allow_always"))
        {
            let mut payload = json!({
                "behavior": "allow",
                "updatedInput": tool_input,
                "toolUseID": tool_use_id,
            });
            if option_id == Some("allow_always") {
                payload["updatedPermissions"] = build_session_permissions(suggestions, tool_name);
            }
            return Ok(payload);
        }

        // buildDenialResult
        let feedback = response
            .pointer("/_meta/customInput")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|f| !f.is_empty());
        let message = match feedback {
            Some(feedback) => {
                format!("User refused permission to run tool with feedback: {feedback}")
            }
            None => "User refused permission to run tool".to_string(),
        };
        self.emit_tool_denial(session, tool_use_id, &message);
        Ok(json!({
            "behavior": "deny",
            "message": message,
            "interrupt": feedback.is_none(),
            "toolUseID": tool_use_id,
        }))
    }

    async fn exit_plan_mode_flow(
        self: &Arc<Self>,
        session: &Arc<ClaudeSession>,
        tool_input: &Value,
        tool_use_id: &Value,
    ) -> Result<Value, String> {
        // Fill the plan from the plan file or the latest assistant text when
        // the tool call itself carries none.
        let mut updated_input = tool_input.clone();
        if updated_input.get("plan").and_then(Value::as_str).is_none() {
            let fallback = session
                .last_plan_content
                .lock()
                .expect("plan lock")
                .clone()
                .or_else(|| {
                    let latest = session
                        .latest_assistant_text
                        .lock()
                        .expect("assistant text lock")
                        .clone();
                    if latest.is_empty() {
                        None
                    } else {
                        Some(latest)
                    }
                });
            if let Some(fallback) = fallback {
                updated_input["plan"] = json!(fallback);
            }
        }

        let plan_text = updated_input
            .get("plan")
            .and_then(Value::as_str)
            .map(str::to_string);
        let valid = plan_text.as_deref().map(is_plan_ready).unwrap_or(false);
        if !valid {
            let message = match plan_text {
                None => format!(
                    "Plan not ready. Provide the full markdown plan in ExitPlanMode or write it to {} before requesting approval.",
                    claude_plans_dir().display()
                ),
                Some(_) => "Plan not ready. Provide the full markdown plan in ExitPlanMode before requesting approval.".to_string(),
            };
            self.emit_tool_denial(session, tool_use_id, &message);
            return Ok(json!({
                "behavior": "deny",
                "message": message,
                "interrupt": false,
                "toolUseID": tool_use_id,
            }));
        }

        let mode_before_plan = session
            .mode_before_plan
            .lock()
            .expect("plan mode lock")
            .clone();
        let info = tool_info("ExitPlanMode", &updated_input, &session.cwd);
        let mut raw_input = updated_input.clone();
        raw_input["toolName"] = json!("ExitPlanMode");
        let response = self
            .request_permission(
                session,
                build_exit_plan_mode_options(mode_before_plan.as_deref()),
                json!({
                    "toolCallId": tool_use_id,
                    "title": info.title,
                    "kind": info.kind,
                    "content": info.content,
                    "rawInput": raw_input,
                }),
            )
            .await?;

        let outcome = response.pointer("/outcome/outcome").and_then(Value::as_str);
        let option_id = response
            .pointer("/outcome/optionId")
            .and_then(Value::as_str)
            .unwrap_or("");
        if outcome == Some("selected")
            && matches!(
                option_id,
                "auto" | "default" | "acceptEdits" | "bypassPermissions"
            )
        {
            self.apply_session_mode(session, option_id).await?;
            return Ok(json!({
                "behavior": "allow",
                "updatedInput": updated_input,
                "updatedPermissions": [{
                    "type": "setMode",
                    "mode": option_id,
                    "destination": "localSettings",
                }],
                "toolUseID": tool_use_id,
            }));
        }

        let feedback = response
            .pointer("/_meta/customInput")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|f| !f.is_empty());
        let message = match feedback {
            Some(feedback) => format!("User rejected the plan with feedback: {feedback}"),
            None => "User rejected the plan. Wait for the user to provide direction.".to_string(),
        };
        self.emit_tool_denial(session, tool_use_id, &message);
        Ok(json!({
            "behavior": "deny",
            "message": message,
            "interrupt": feedback.is_none(),
            "toolUseID": tool_use_id,
        }))
    }

    async fn ask_user_question_flow(
        self: &Arc<Self>,
        session: &Arc<ClaudeSession>,
        tool_input: &Value,
        tool_use_id: &Value,
    ) -> Result<Value, String> {
        let Some(questions) = normalize_questions(tool_input) else {
            return Ok(json!({
                "behavior": "deny",
                "message": "No questions provided",
                "toolUseID": tool_use_id,
            }));
        };
        let first = &questions[0];
        let info = tool_info("AskUserQuestion", tool_input, &session.cwd);
        let response = self
            .request_permission(
                session,
                build_question_options(first),
                json!({
                    "toolCallId": tool_use_id,
                    "title": first.get("question").cloned().unwrap_or(Value::Null),
                    "kind": "other",
                    "content": info.content,
                    "_meta": {
                        "codeToolKind": "question",
                        "questions": questions,
                    },
                }),
            )
            .await?;

        let outcome = response.pointer("/outcome/outcome").and_then(Value::as_str);
        let custom_message = response
            .pointer("/_meta/message")
            .and_then(Value::as_str)
            .map(str::to_string);

        // A cancelled outcome carrying a message is a deliberate "park the
        // question" response (Slack relay, unattended cloud run) — deliver it
        // to the model as a denial so it waits for the user instead of
        // deciding on its own. A bare cancel remains a tool-use abort.
        if outcome == Some("cancelled") {
            if let Some(message) = custom_message {
                return Ok(json!({
                    "behavior": "deny",
                    "message": message,
                    "toolUseID": tool_use_id,
                }));
            }
            return Err("Tool use aborted".to_string());
        }

        if outcome != Some("selected") {
            return Ok(json!({
                "behavior": "deny",
                "message": custom_message
                    .unwrap_or_else(|| "User cancelled the questions".to_string()),
                "toolUseID": tool_use_id,
            }));
        }

        let answers = response.pointer("/_meta/answers").cloned();
        let has_answers = answers
            .as_ref()
            .and_then(Value::as_object)
            .map(|answers| !answers.is_empty())
            .unwrap_or(false);
        if !has_answers {
            return Ok(json!({
                "behavior": "deny",
                "message": "User did not provide answers",
                "toolUseID": tool_use_id,
            }));
        }

        let mut updated_input = tool_input.clone();
        updated_input["answers"] = answers.unwrap_or(Value::Null);
        Ok(json!({
            "behavior": "allow",
            "updatedInput": updated_input,
            "toolUseID": tool_use_id,
        }))
    }
}

/// `buildSessionPermissions`: the allow_always persistence shape handed back
/// to the SDK (session-scoped rules from the CLI's own suggestions, or a
/// bare tool-name rule).
fn build_session_permissions(suggestions: Option<&Value>, tool_name: &str) -> Value {
    if let Some(suggestions) = suggestions.and_then(Value::as_array) {
        if !suggestions.is_empty() {
            return json!(suggestions);
        }
    }
    json!([{
        "type": "addRules",
        "rules": [{ "toolName": tool_name }],
        "behavior": "allow",
        "destination": "session",
    }])
}

/// buildSystemPrompt (session/options.ts): session-meta systemPrompt →
/// (full-replacement prompt, appendSystemPrompt) for the CLI initialize.
fn build_system_prompt_fields(meta: &Value) -> (Option<Value>, Option<String>) {
    match meta.get("systemPrompt") {
        Some(Value::String(user)) => (
            Some(json!([format!("{user}{APPENDED_INSTRUCTIONS}")])),
            None,
        ),
        Some(Value::Object(preset)) => {
            let user_append = preset
                .get("append")
                .and_then(Value::as_str)
                .unwrap_or_default();
            (None, Some(format!("{user_append}{APPENDED_INSTRUCTIONS}")))
        }
        _ => (None, Some(APPENDED_INSTRUCTIONS.to_string())),
    }
}

// ---------------------------------------------------------------------------
// ACP handler (requests from the agent-server)

struct AgentHandler {
    driver: Arc<Driver>,
}

#[async_trait::async_trait]
impl IncomingHandler for AgentHandler {
    async fn handle_request(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        match method {
            methods::INITIALIZE => Ok(json!({
                "protocolVersion": PROTOCOL_VERSION,
                "agentCapabilities": {
                    "promptCapabilities": { "image": true, "embeddedContext": true },
                    "mcpCapabilities": { "http": true, "sse": true },
                    "loadSession": false,
                    "_meta": {
                        "posthog": { "steering": "native" },
                        "claudeCode": { "promptQueueing": true },
                    },
                },
                "agentInfo": {
                    "name": "posthog-claude-driver",
                    "title": "Claude Agent (Rust)",
                    "version": crate::driver_version(),
                },
                "authMethods": [],
            })),
            methods::SESSION_NEW => self.driver.new_session(params).await,
            ext::SESSION_RESUME => self.driver.resume_session(params).await,
            methods::SESSION_PROMPT => self.driver.prompt(params).await,
            methods::SESSION_SET_MODE => self.driver.set_mode(params).await,
            methods::SESSION_SET_CONFIG_OPTION => self.driver.set_config_option(params).await,
            ext::REFRESH_SESSION => self.driver.refresh_session(params).await,
            other => Err(RpcError::method_not_found(other)),
        }
    }

    async fn handle_notification(&self, method: &str, params: Value) {
        match method {
            methods::SESSION_CANCEL => self.driver.cancel(params),
            other => tracing::debug!(method = other, "Ignoring notification"),
        }
    }
}

// ---------------------------------------------------------------------------
// Control handler (requests from the CLI)

struct SessionControlHandler {
    driver: Arc<Driver>,
    session: std::sync::Weak<ClaudeSession>,
}

#[async_trait::async_trait]
impl ControlHandler for SessionControlHandler {
    async fn handle_control_request(&self, request: Value) -> Result<Value, String> {
        let Some(session) = self.session.upgrade() else {
            return Err("Session has ended".to_string());
        };
        match request.get("subtype").and_then(Value::as_str) {
            Some("can_use_tool") => self.driver.handle_can_use_tool(&session, &request).await,
            Some("hook_callback") => self.driver.handle_hook_callback(&session, &request).await,
            Some("mcp_message") => self.driver.handle_mcp_message(&session, &request).await,
            other => Err(format!(
                "Unsupported control request: {}",
                other.unwrap_or("<unknown>")
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_guard_blocks_direct_commit_and_push() {
        assert!(blocks_unsigned_git("git commit -m 'x'"));
        assert!(blocks_unsigned_git("git add -A && git commit -m x"));
        assert!(blocks_unsigned_git("git push origin main"));
        assert!(blocks_unsigned_git("/usr/bin/git -C /tmp/repo push"));
        assert!(blocks_unsigned_git("echo hi; git push"));
        assert!(blocks_unsigned_git("true || git commit"));
        assert!(!blocks_unsigned_git("git stash push"));
        assert!(!blocks_unsigned_git("git log --grep=commit"));
        assert!(!blocks_unsigned_git("git status"));
        assert!(!blocks_unsigned_git("echo 'commit'"));
        assert!(!blocks_unsigned_git("cargo build"));
    }

    #[test]
    fn mode_gating_matches_tools_ts() {
        assert!(is_tool_allowed_for_mode("Bash", "bypassPermissions"));
        assert!(is_tool_allowed_for_mode("Bash", "auto"));
        assert!(!is_tool_allowed_for_mode("Bash", "acceptEdits"));
        assert!(!is_tool_allowed_for_mode("Bash", "default"));
        assert!(is_tool_allowed_for_mode("Edit", "acceptEdits"));
        assert!(!is_tool_allowed_for_mode("Edit", "plan"));
        assert!(is_tool_allowed_for_mode("Read", "plan"));
        assert!(is_tool_allowed_for_mode("Task", "default"));
        assert!(!is_tool_allowed_for_mode("ExitPlanMode", "default"));
        assert!(!is_tool_allowed_for_mode("mcp__posthog__exec", "default"));
    }

    #[test]
    fn plan_readiness_requires_length_and_heading() {
        assert!(!is_plan_ready("short"));
        assert!(!is_plan_ready(
            "a plan without any headings that is nevertheless long enough to pass the length gate"
        ));
        assert!(is_plan_ready(
            "# The plan\n\nDo the thing, then do the other thing, carefully."
        ));
        assert!(is_plan_ready(
            "intro text\n### Steps\n1. first step of the plan\n2. second step"
        ));
    }

    #[test]
    fn domain_allowlist_supports_wildcards() {
        let allowed = vec!["*.posthog.com".to_string(), "example.org".to_string()];
        assert!(is_domain_allowed("posthog.com", &allowed));
        assert!(is_domain_allowed("us.posthog.com", &allowed));
        assert!(is_domain_allowed("example.org", &allowed));
        assert!(!is_domain_allowed("evil.org", &allowed));
        assert!(!is_domain_allowed("posthog.com.evil.org", &allowed));
        assert_eq!(
            extract_domain_from_url("https://us.posthog.com/api/x?y=1"),
            Some("us.posthog.com".to_string())
        );
        assert_eq!(extract_domain_from_url("not a url"), None);
    }

    #[test]
    fn posthog_exec_gate_detects_destructive_sub_tools() {
        assert!(is_posthog_exec_tool("mcp__posthog__exec"));
        assert!(is_posthog_exec_tool("mcp__posthog_us__exec"));
        assert!(!is_posthog_exec_tool(
            "mcp__posthog-code-tools__git_signed_commit"
        ));
        assert_eq!(
            extract_posthog_sub_tool(&json!({ "command": "call dashboard-delete {}" })),
            Some("dashboard-delete".to_string())
        );
        assert_eq!(
            extract_posthog_sub_tool(&json!({ "command": "  call --json insight-update {}" })),
            Some("insight-update".to_string())
        );
        assert!(is_posthog_destructive_sub_tool("dashboard-delete"));
        assert!(is_posthog_destructive_sub_tool("update"));
        assert!(is_posthog_destructive_sub_tool("insight-partial-update"));
        assert!(!is_posthog_destructive_sub_tool("dashboard-get"));
    }

    #[test]
    fn exit_plan_mode_options_prefer_previous_mode() {
        let options = build_exit_plan_mode_options(Some("acceptEdits"));
        let options = options.as_array().unwrap();
        assert_eq!(options[0]["optionId"], "acceptEdits");
        assert_eq!(options[0]["name"], "Yes, continue auto-accepting edits");
        let last = options.last().unwrap();
        assert_eq!(last["optionId"], "reject_with_feedback");
        assert_eq!(last["_meta"]["customInput"], true);
    }

    #[test]
    fn question_options_are_indexed() {
        let questions = normalize_questions(&json!({
            "question": "Which db?",
            "options": [
                { "label": "Postgres", "description": "relational" },
                { "label": "ClickHouse" },
            ],
        }))
        .unwrap();
        assert_eq!(questions.len(), 1);
        let options = build_question_options(&questions[0]);
        assert_eq!(options[0]["optionId"], "option_0");
        assert_eq!(options[0]["name"], "Postgres");
        assert_eq!(options[0]["_meta"]["description"], "relational");
        assert_eq!(options[1]["optionId"], "option_1");
        assert!(options[1].get("_meta").is_none());
    }
}
