//! The ACP agent core: agent-server (ACP over stdio) on one side, the codex
//! app-server (JSON-RPC over stdio) on the other.
//!
//! Port of `codex-app-server-agent.ts` restricted to the cloud surface the
//! Rust agent-server drives: `initialize`, `session/new`, `session/prompt`
//! (steer via `turn/steer`), `session/cancel`, `session/set_mode` /
//! `session/set_config_option`. Approvals (`approvals.ts`) relay through
//! ACP `session/request_permission`; the signed-git local tools are injected
//! as a stdio MCP server (this binary re-invoked with `--local-tools-mcp`).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use base64::Engine as _;
use posthog_acp::{
    client_methods, ext, methods, IncomingHandler, Peer, RpcError, PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use posthog_agent_tools::signed_git::{resolve_github_token, SANDBOX_ENV_FILE};

use crate::input::to_codex_input;
use crate::mapping::{
    change_paths, diff_content, map_app_server_notification, notifications, requests,
};
use crate::modes::SessionConfigState;
use crate::rpc::{CodexRpc, ServerRequestHandler};
use crate::sidecar::SidecarConfig;
use crate::spawn::{resolve_codex_binary, spawn_app_server, AppServerOptions};
use crate::structured::parse_structured_output;
use crate::turns::TurnController;
use crate::usage::{turn_complete_params, UsageTracker};

pub const LOCAL_TOOLS_MCP_NAME: &str = "posthog-code-tools";
const LOCAL_TOOLS_ENABLED: &str = "git_signed_commit,git_signed_merge,git_signed_rewrite";
const OPTION_PREFIX: &str = "option_";

// ---------------------------------------------------------------------------
// MCP call correlation (mcp-manager.ts)

#[derive(Debug, Clone)]
struct McpCall {
    server: String,
    tool: String,
    args: Value,
}

/// Correlates codex approval prompts back to the MCP tool that triggered
/// them: by item id for a command approval, or by server name for an
/// elicitation (which carries no id, so it maps to the latest in-flight call
/// — MCP calls are sequential).
#[derive(Default)]
struct McpTracker {
    by_id: HashMap<String, McpCall>,
    latest: Option<McpCall>,
}

impl McpTracker {
    fn read_item(params: &Value) -> Option<(String, McpCall)> {
        let item = params.get("item")?;
        if item.get("type").and_then(Value::as_str) != Some("mcpToolCall") {
            return None;
        }
        let id = item.get("id").and_then(Value::as_str)?;
        let server = item.get("server").and_then(Value::as_str)?;
        let tool = item.get("tool").and_then(Value::as_str)?;
        Some((
            id.to_string(),
            McpCall {
                server: server.to_string(),
                tool: tool.to_string(),
                args: item.get("arguments").cloned().unwrap_or(Value::Null),
            },
        ))
    }

    fn capture(&mut self, params: &Value) {
        if let Some((id, call)) = Self::read_item(params) {
            self.latest = Some(call.clone());
            self.by_id.insert(id, call);
        }
    }

    /// Evict on item/completed — approvals only arrive while a call is in
    /// flight, and keeping every finished call would grow for the session's
    /// lifetime.
    fn release(&mut self, params: &Value) {
        if let Some((id, call)) = Self::read_item(params) {
            self.by_id.remove(&id);
            if let Some(latest) = &self.latest {
                if latest.server == call.server && latest.tool == call.tool {
                    self.latest = None;
                }
            }
        }
    }

    fn by_item_id(&self, item_id: Option<&str>) -> Option<McpCall> {
        item_id.and_then(|id| self.by_id.get(id).cloned())
    }

    fn by_server(&self, server_name: &str) -> Option<McpCall> {
        self.latest
            .as_ref()
            .filter(|call| call.server == server_name)
            .cloned()
    }
}

// ---------------------------------------------------------------------------
// Session state

struct CodexSession {
    /// ACP session id == the codex thread id.
    session_id: String,
    config: Mutex<SessionConfigState>,
    turns: Mutex<TurnController>,
    usage: Mutex<UsageTracker>,
    mcp: Mutex<McpTracker>,
    /// True between a contextCompaction item's start and its boundary.
    compaction_active: AtomicBool,
    /// Final assistant message text for the in-flight turn (structured output).
    last_agent_message: Mutex<String>,
    /// JSON schema constraining the final message; set via `_meta.jsonSchema`.
    json_schema: Option<Value>,
    task_run_id: Option<String>,
    /// On "cloud" a non-danger sandbox would panic, so per-turn sandbox
    /// overrides are skipped.
    environment: Option<String>,
    /// Gates notification mapping after an interrupt.
    cancelled: AtomicBool,
}

fn map_turn_stop_reason(status: Option<&str>) -> &'static str {
    match status {
        Some("interrupted") => "cancelled",
        Some("failed") => "refusal",
        _ => "end_turn",
    }
}

/// Flatten the host's systemPrompt (`string | { append }`) to a string.
fn flatten_system_prompt(system_prompt: Option<&Value>) -> Option<String> {
    match system_prompt {
        Some(Value::String(text)) if !text.is_empty() => Some(text.clone()),
        Some(Value::Object(preset)) => preset
            .get("append")
            .and_then(Value::as_str)
            .filter(|a| !a.is_empty())
            .map(str::to_string),
        _ => None,
    }
}

/// ACP `McpServer[]` → codex `config.mcp_servers` map — ACP encodes
/// env/headers as `{name, value}[]`, codex wants plain string maps
/// (`mcp-config.ts`).
fn to_codex_mcp_servers(servers: &[Value]) -> serde_json::Map<String, Value> {
    let pairs_to_map = |pairs: Option<&Value>| -> Option<Value> {
        let pairs = pairs.and_then(Value::as_array)?;
        if pairs.is_empty() {
            return None;
        }
        let mut map = serde_json::Map::new();
        for pair in pairs {
            if let (Some(name), Some(value)) = (
                pair.get("name").and_then(Value::as_str),
                pair.get("value").and_then(Value::as_str),
            ) {
                map.insert(name.to_string(), json!(value));
            }
        }
        Some(Value::Object(map))
    };

    let mut out = serde_json::Map::new();
    for server in servers {
        let Some(name) = server.get("name").and_then(Value::as_str) else {
            continue;
        };
        if let Some(command) = server.get("command").and_then(Value::as_str) {
            let mut entry = json!({
                "command": command,
                "args": server.get("args").cloned().unwrap_or_else(|| json!([])),
            });
            if let Some(env) = pairs_to_map(server.get("env")) {
                entry["env"] = env;
            }
            out.insert(name.to_string(), entry);
        } else if let Some(url) = server.get("url").and_then(Value::as_str) {
            let mut entry = json!({ "url": url });
            if let Some(headers) = pairs_to_map(server.get("headers")) {
                entry["http_headers"] = headers;
            }
            out.insert(name.to_string(), entry);
        }
    }
    out
}

fn is_cloud_run(meta: &Value) -> bool {
    match meta.get("environment").and_then(Value::as_str) {
        Some(environment) => environment == "cloud",
        None => std::env::var("IS_SANDBOX").is_ok(),
    }
}

/// The signed-git local tools as a codex stdio MCP server entry: this binary
/// re-invoked with `--local-tools-mcp` (the port of `local-tools-mcp.ts`,
/// which spawns `local-tools-mcp-server.js`). Cloud runs only.
fn build_local_tools_entry(cwd: &str, meta: &Value) -> Option<Value> {
    if !is_cloud_run(meta) {
        return None;
    }
    let current_exe = std::env::current_exe().ok()?;
    let token = resolve_github_token(SANDBOX_ENV_FILE);
    let task_id = meta
        .get("taskId")
        .and_then(Value::as_str)
        .or_else(|| meta.pointer("/persistence/taskId").and_then(Value::as_str));

    let mut ctx = json!({ "cwd": cwd });
    if let Some(token) = &token {
        ctx["token"] = json!(token);
    }
    if let Some(task_id) = task_id {
        ctx["taskId"] = json!(task_id);
    }
    if let Some(base_branch) = meta.get("baseBranch").and_then(Value::as_str) {
        ctx["baseBranch"] = json!(base_branch);
    }
    let ctx_base64 = base64::engine::general_purpose::STANDARD.encode(ctx.to_string());

    let mut env = json!({
        "POSTHOG_LOCAL_TOOLS_CTX": ctx_base64,
        "POSTHOG_LOCAL_TOOLS_ENABLED": LOCAL_TOOLS_ENABLED,
    });
    if let Some(token) = &token {
        // Token also on the child env so its own git remote ops authenticate.
        env["GH_TOKEN"] = json!(token);
        env["GITHUB_TOKEN"] = json!(token);
    }

    Some(json!({
        "command": current_exe.to_string_lossy(),
        "args": ["--local-tools-mcp"],
        "env": env,
    }))
}

// ---------------------------------------------------------------------------
// The driver

pub struct Driver {
    peer: OnceLock<Peer>,
    rpc: OnceLock<CodexRpc>,
    sidecar: SidecarConfig,
    session: Mutex<Option<Arc<CodexSession>>>,
    child: Mutex<Option<tokio::process::Child>>,
}

impl Driver {
    pub fn new(sidecar: SidecarConfig) -> Arc<Self> {
        Arc::new(Self {
            peer: OnceLock::new(),
            rpc: OnceLock::new(),
            sidecar,
            session: Mutex::new(None),
            child: Mutex::new(None),
        })
    }

    /// Spawn the app-server, then run the ACP agent over the given stdio;
    /// resolves when the client closes the connection.
    pub async fn run<R, W>(self: &Arc<Self>, read: R, write: W)
    where
        R: tokio::io::AsyncRead + Unpin + Send + 'static,
        W: tokio::io::AsyncWrite + Unpin + Send + 'static,
    {
        // The native app-server is the only codex harness. A missing binary
        // is a packaging bug — fail loudly instead of degrading.
        let Some(binary_path) = resolve_codex_binary() else {
            eprintln!(
                "[codex-acp-driver] native codex binary not found \
                 (set POSTHOG_CODEX_BINARY_PATH or install @openai/codex)"
            );
            return;
        };
        let options = AppServerOptions {
            binary_path,
            cwd: self
                .sidecar
                .codex_options
                .as_ref()
                .and_then(|o| o.cwd.clone())
                .unwrap_or_else(|| "/tmp/workspace".to_string()),
            api_base_url: self
                .sidecar
                .gateway_env
                .as_ref()
                .map(|g| g.openai_base_url.clone())
                .filter(|u| !u.is_empty()),
            api_key: self.sidecar.gateway_api_key(),
            codex_home: std::env::var("CODEX_HOME").ok(),
        };
        let spawned = match spawn_app_server(&options) {
            Ok(spawned) => spawned,
            Err(err) => {
                eprintln!("[codex-acp-driver] failed to spawn codex app-server: {err}");
                return;
            }
        };
        let approval_handler = Arc::new(ApprovalHandler {
            driver: Arc::clone(self),
        });
        let (rpc, notif_rx) = CodexRpc::spawn(spawned.stdout, spawned.stdin, approval_handler);
        let _ = self.rpc.set(rpc);
        *self.child.lock().expect("child lock") = Some(spawned.child);
        self.spawn_notification_pump(notif_rx);

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

    fn rpc(&self) -> &CodexRpc {
        self.rpc.get().expect("rpc initialized in run()")
    }

    fn current_session(&self) -> Option<Arc<CodexSession>> {
        self.session.lock().expect("session lock").clone()
    }

    fn require_session(&self) -> Result<Arc<CodexSession>, RpcError> {
        self.current_session()
            .ok_or_else(|| RpcError::new(-32602, "No active session"))
    }

    fn session_update(&self, session: &CodexSession, update: Value) {
        self.peer().notify(
            client_methods::SESSION_UPDATE,
            json!({ "sessionId": session.session_id, "update": update }),
        );
    }

    fn emit_config_options(&self, session: &CodexSession) {
        let options = session.config.lock().expect("config lock").options();
        self.session_update(
            session,
            json!({ "sessionUpdate": "config_option_update", "configOptions": options }),
        );
    }

    fn emit_current_mode(&self, session: &CodexSession) {
        let mode = session.config.lock().expect("config lock").mode();
        self.session_update(
            session,
            json!({ "sessionUpdate": "current_mode_update", "currentModeId": mode }),
        );
    }

    // -- notifications from the app-server -------------------------------------

    fn spawn_notification_pump(
        self: &Arc<Self>,
        mut notif_rx: mpsc::UnboundedReceiver<(String, Value)>,
    ) {
        let driver = Arc::clone(self);
        tokio::spawn(async move {
            while let Some((method, params)) = notif_rx.recv().await {
                driver.handle_notification(&method, params);
            }
            // Stream ended: the app-server exited. Fail the in-flight turn so
            // prompt() returns rather than hangs.
            if let Some(session) = driver.current_session() {
                session
                    .turns
                    .lock()
                    .expect("turns lock")
                    .fail("codex app-server exited before the turn completed");
            }
        });
    }

    fn handle_notification(self: &Arc<Self>, method: &str, params: Value) {
        let Some(session) = self.current_session() else {
            return;
        };

        if !session.cancelled.load(Ordering::SeqCst) {
            if let Some(update) = map_app_server_notification(method, &params) {
                self.session_update(&session, update);
            }
        }

        let is_compaction_item =
            params.pointer("/item/type").and_then(Value::as_str) == Some("contextCompaction");

        match method {
            notifications::TURN_STARTED => {
                // Capture the active turn id (steer precondition / interrupt target).
                session
                    .turns
                    .lock()
                    .expect("turns lock")
                    .on_started(params.pointer("/turn/id").and_then(Value::as_str));
            }
            notifications::ITEM_STARTED => {
                session.mcp.lock().expect("mcp lock").capture(&params);
                // codex auto-compaction surfaces as a contextCompaction item:
                // item/started → in progress, item/completed → boundary.
                if is_compaction_item && !session.compaction_active.swap(true, Ordering::SeqCst) {
                    self.peer().notify(
                        ext::STATUS,
                        json!({ "sessionId": session.session_id, "status": "compacting" }),
                    );
                }
            }
            notifications::ITEM_COMPLETED => {
                session.mcp.lock().expect("mcp lock").release(&params);
                // Track the latest assistant message (structured output source).
                if params.pointer("/item/type").and_then(Value::as_str) == Some("agentMessage") {
                    if let Some(text) = params.pointer("/item/text").and_then(Value::as_str) {
                        *session
                            .last_agent_message
                            .lock()
                            .expect("agent message lock") = text.to_string();
                    }
                }
                if is_compaction_item {
                    self.emit_compaction_boundary(&session);
                }
            }
            notifications::CONTEXT_COMPACTED => {
                // Guarded fallback: codex usually emits no separate
                // thread/compacted when the compaction item completes.
                self.emit_compaction_boundary(&session);
            }
            notifications::TOKEN_USAGE_UPDATED => {
                let update = session.usage.lock().expect("usage lock").ingest(&params);
                if let Some(mut update) = update {
                    update["sessionId"] = json!(session.session_id);
                    self.peer().notify(ext::USAGE_UPDATE, update);
                }
            }
            notifications::TURN_COMPLETED => {
                let turn_id = params.pointer("/turn/id").and_then(Value::as_str);
                // Drop the late completion of an already-interrupted turn
                // (else it cancels the follow-up).
                if session
                    .turns
                    .lock()
                    .expect("turns lock")
                    .should_drop_completion(turn_id)
                {
                    return;
                }
                let status = params.pointer("/turn/status").and_then(Value::as_str);
                self.finalize_turn(&session, map_turn_stop_reason(status));
            }
            notifications::ERROR => {
                // A non-retried fatal error: resolve the turn so prompt()
                // returns rather than hangs.
                if params.get("willRetry").and_then(Value::as_bool) == Some(false) {
                    tracing::warn!(?params, "codex app-server fatal error notification");
                    self.finalize_turn(&session, "refusal");
                }
            }
            _ => {}
        }
    }

    /// Compaction finished: `_posthog/compact_boundary` (host clears
    /// isCompacting) + a transcript marker.
    fn emit_compaction_boundary(&self, session: &CodexSession) {
        if !session.compaction_active.swap(false, Ordering::SeqCst) {
            return;
        }
        self.peer().notify(
            ext::COMPACT_BOUNDARY,
            json!({ "sessionId": session.session_id }),
        );
        self.session_update(
            session,
            json!({
                "sessionUpdate": "agent_message_chunk",
                "content": { "type": "text", "text": "\n\nContext compacted." },
            }),
        );
    }

    /// Deliver structured output and the per-turn notifications, then resolve
    /// every completion waiter. Idempotent: `claim` empties synchronously so a
    /// second finalize (e.g. an error racing turn/completed) is a no-op.
    fn finalize_turn(self: &Arc<Self>, session: &Arc<CodexSession>, reason: &str) {
        let waiters = session.turns.lock().expect("turns lock").claim();
        if waiters.is_empty() {
            return;
        }
        // If the turn dies mid-compaction the boundary never fires, leaving
        // isCompacting stuck true (silently queuing later messages).
        self.emit_compaction_boundary(session);

        let message = session
            .last_agent_message
            .lock()
            .expect("agent message lock")
            .clone();
        // Deliver structured output only on a clean end_turn — a
        // cancelled/refused turn records nothing.
        if reason == "end_turn" && session.json_schema.is_some() && !message.is_empty() {
            match parse_structured_output(&message) {
                Some(output) => self.peer().notify(
                    ext::STRUCTURED_OUTPUT,
                    json!({ "sessionId": session.session_id, "output": output }),
                ),
                None => tracing::warn!(
                    preview = &message[..message.len().min(200)],
                    "Could not parse structured output from final message"
                ),
            }
        }

        let (usage, context_used) = {
            let tracker = session.usage.lock().expect("usage lock");
            (tracker.per_turn_usage(), tracker.context_tokens())
        };
        // `_posthog/turn_complete` only with a taskRunId (cloud), the usage
        // breakdown whenever usage arrived.
        if session.task_run_id.is_some() {
            self.peer().notify(
                ext::TURN_COMPLETE,
                turn_complete_params(&session.session_id, reason, usage),
            );
        }
        if let Some(context_used) = context_used {
            let breakdown = session
                .usage
                .lock()
                .expect("usage lock")
                .breakdown(context_used);
            self.peer().notify(
                ext::USAGE_UPDATE,
                json!({ "sessionId": session.session_id, "breakdown": breakdown }),
            );
        }

        for waiter in waiters {
            let _ = waiter.send(Ok(reason.to_string()));
        }
    }

    // -- ACP surface -----------------------------------------------------------

    async fn initialize(&self) -> Result<Value, RpcError> {
        self.rpc()
            .request(
                "initialize",
                json!({
                    "clientInfo": {
                        "name": "posthog-code",
                        "title": "PostHog Code",
                        "version": "0.1.0",
                    },
                    // Opt into codex's experimental API so experimental
                    // turn/start fields are honored.
                    "capabilities": { "experimentalApi": true, "requestAttestation": false },
                }),
            )
            .await
            .map_err(|err| RpcError::internal(format!("codex initialize failed: {err}")))?;
        self.rpc().notify("initialized", json!({}));

        Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "agentCapabilities": {
                "promptCapabilities": { "image": true, "embeddedContext": true },
                // Only http: we don't claim SSE rather than mistranslate it.
                "mcpCapabilities": { "http": true },
                "loadSession": false,
                "_meta": { "posthog": { "steering": "native" } },
            },
            "agentInfo": {
                "name": "codex",
                "title": "Codex (app-server)",
                "version": crate::driver_version(),
            },
            "authMethods": [],
        }))
    }

    async fn new_session(self: &Arc<Self>, params: Value) -> Result<Value, RpcError> {
        let sidecar_options = self.sidecar.codex_options.clone().unwrap_or_default();
        let cwd = params
            .get("cwd")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or(sidecar_options.cwd)
            .unwrap_or_else(|| "/tmp/workspace".to_string());
        let meta = params.get("_meta").cloned().unwrap_or_else(|| json!({}));

        let mut config = SessionConfigState::new(
            sidecar_options.model.as_deref(),
            sidecar_options.reasoning_effort.as_deref(),
        );
        config.set_initial_mode(meta.get("permissionMode").and_then(Value::as_str));

        let system_prompt = flatten_system_prompt(meta.get("systemPrompt"));
        let mut usage = UsageTracker::default();
        usage.set_baseline(system_prompt.as_deref());

        // Flatten the {append} form and dedupe identical parts (the host can
        // pre-flatten into developerInstructions, which would duplicate).
        let mut developer_parts: Vec<String> = Vec::new();
        for part in [sidecar_options.developer_instructions, system_prompt] {
            if let Some(part) = part.filter(|p| !p.is_empty()) {
                if !developer_parts.contains(&part) {
                    developer_parts.push(part);
                }
            }
        }
        let developer_instructions = developer_parts.join("\n\n");

        let mut mcp_servers = to_codex_mcp_servers(
            params
                .get("mcpServers")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or(&[]),
        );
        if let Some(local_tools) = build_local_tools_entry(&cwd, &meta) {
            mcp_servers.insert(LOCAL_TOOLS_MCP_NAME.to_string(), local_tools);
        }

        let mut thread_config = serde_json::Map::new();
        if !mcp_servers.is_empty() {
            thread_config.insert("mcp_servers".to_string(), Value::Object(mcp_servers));
        }
        if let Some(dirs) = params
            .get("additionalDirectories")
            .and_then(Value::as_array)
        {
            if !dirs.is_empty() {
                thread_config.insert(
                    "sandbox_workspace_write".to_string(),
                    json!({ "writable_roots": dirs }),
                );
            }
        }

        let mut request = json!({ "model": config.model(), "cwd": cwd });
        if !developer_instructions.is_empty() {
            request["developerInstructions"] = json!(developer_instructions);
        }
        if !thread_config.is_empty() {
            request["config"] = Value::Object(thread_config);
        }

        let result = self
            .rpc()
            .request("thread/start", request)
            .await
            .map_err(|err| RpcError::internal(format!("thread/start failed: {err}")))?;
        let thread_id = result
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                RpcError::internal("codex app-server thread/start returned no thread id")
            })?
            .to_string();

        let session = Arc::new(CodexSession {
            session_id: thread_id.clone(),
            config: Mutex::new(config),
            turns: Mutex::new(TurnController::default()),
            usage: Mutex::new(usage),
            mcp: Mutex::new(McpTracker::default()),
            compaction_active: AtomicBool::new(false),
            last_agent_message: Mutex::new(String::new()),
            json_schema: meta.get("jsonSchema").filter(|s| !s.is_null()).cloned(),
            task_run_id: meta
                .get("taskRunId")
                .and_then(Value::as_str)
                .map(str::to_string),
            environment: meta
                .get("environment")
                .and_then(Value::as_str)
                .map(str::to_string),
            cancelled: AtomicBool::new(false),
        });
        *self.session.lock().expect("session lock") = Some(Arc::clone(&session));

        self.load_model_config(&session).await;
        self.emit_config_options(&session);
        self.emit_available_commands(&session).await;
        // `_posthog/sdk_session` maps the taskRunId to this session so the
        // host can resume later. Adapter stays "codex" so resume/keying
        // treats both codex transports as the same agent family.
        if let Some(task_run_id) = &session.task_run_id {
            self.peer().notify(
                ext::SDK_SESSION,
                json!({
                    "taskRunId": task_run_id,
                    "sessionId": session.session_id,
                    "adapter": "codex",
                }),
            );
        }

        let config_options = session.config.lock().expect("config lock").options();
        Ok(json!({ "sessionId": thread_id, "configOptions": config_options }))
    }

    async fn load_model_config(&self, session: &CodexSession) {
        match self.rpc().request("model/list", json!({})).await {
            Ok(result) => {
                let models = result
                    .get("data")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                session
                    .config
                    .lock()
                    .expect("config lock")
                    .load_models(&models);
            }
            Err(err) => {
                tracing::warn!(error = %err, "model/list failed; using current model only");
                session.config.lock().expect("config lock").clear_models();
            }
        }
    }

    /// skills/list → available_commands_update so the slash-command menu fills.
    async fn emit_available_commands(&self, session: &CodexSession) {
        let commands: Vec<Value> = match self.rpc().request("skills/list", json!({})).await {
            Ok(result) => result
                .get("data")
                .and_then(Value::as_array)
                .map(|entries| {
                    entries
                        .iter()
                        .filter_map(|entry| entry.get("skills").and_then(Value::as_array))
                        .flatten()
                        // Drop explicitly-disabled skills; lenient so a
                        // malformed payload still shows.
                        .filter(|skill| {
                            skill.get("name").and_then(Value::as_str).is_some()
                                && skill.get("enabled").and_then(Value::as_bool) != Some(false)
                        })
                        .map(|skill| {
                            json!({
                                "name": skill.get("name"),
                                "description": skill
                                    .get("description")
                                    .and_then(Value::as_str)
                                    .unwrap_or(""),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default(),
            Err(err) => {
                tracing::warn!(error = %err, "skills/list failed");
                Vec::new()
            }
        };
        self.session_update(
            session,
            json!({
                "sessionUpdate": "available_commands_update",
                "availableCommands": commands,
            }),
        );
    }

    async fn prompt(self: &Arc<Self>, params: Value) -> Result<Value, RpcError> {
        let session = self.require_session()?;
        // Reopen the notification gate (a prior interrupt left cancelled set).
        session.cancelled.store(false, Ordering::SeqCst);

        // Prepend _meta.prContext to the FORWARDED prompt, else codex cloud
        // follow-ups lose the PR-review context. The echo omits it.
        let prompt_blocks = params
            .get("prompt")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut forwarded = prompt_blocks.clone();
        if let Some(pr_context) = params
            .pointer("/_meta/prContext")
            .and_then(Value::as_str)
            .filter(|c| !c.is_empty())
        {
            forwarded.insert(0, json!({ "type": "text", "text": pr_context }));
        }
        let input = to_codex_input(&forwarded);
        if input.is_empty() {
            // turn/start rejects empty input, so end the turn cleanly.
            tracing::warn!("prompt() had no usable input blocks; ending turn");
            return Ok(json!({ "stopReason": "end_turn" }));
        }

        // Echo each user prompt block (codex emits none), for fresh turns and
        // steering alike.
        for block in &prompt_blocks {
            if matches!(
                block.get("type").and_then(Value::as_str),
                Some("text") | Some("image")
            ) {
                self.session_update(
                    &session,
                    json!({ "sessionUpdate": "user_message_chunk", "content": block }),
                );
            }
        }

        enum Dispatch {
            Steer(
                tokio::sync::oneshot::Receiver<crate::turns::TurnResult>,
                Option<String>,
            ),
            Fresh(
                tokio::sync::oneshot::Receiver<crate::turns::TurnResult>,
                u64,
            ),
        }
        let dispatch = {
            let mut turns = session.turns.lock().expect("turns lock");
            if turns.is_running() {
                let expected = turns.active_turn_id().map(str::to_string);
                Dispatch::Steer(turns.join(), expected)
            } else if turns.is_pending() {
                // A turn is pending but has no turnId yet, so we can't steer.
                return Err(RpcError::internal(
                    "prompt() called while a turn is already in progress",
                ));
            } else {
                let (rx, generation) = turns.begin();
                Dispatch::Fresh(rx, generation)
            }
        };

        match dispatch {
            Dispatch::Steer(rx, expected_turn_id) => {
                // Fold the message in via turn/steer; refresh from the
                // response's rotated turnId so a later steer/interrupt still
                // targets the live turn.
                let steer = self
                    .rpc()
                    .request(
                        "turn/steer",
                        json!({
                            "threadId": session.session_id,
                            "input": input,
                            "expectedTurnId": expected_turn_id,
                        }),
                    )
                    .await;
                match steer {
                    Ok(result) => session
                        .turns
                        .lock()
                        .expect("turns lock")
                        .on_steered(result.get("turnId").and_then(Value::as_str)),
                    Err(err) => tracing::warn!(error = %err, "turn/steer failed"),
                }
                await_turn(rx).await
            }
            Dispatch::Fresh(rx, generation) => {
                session
                    .last_agent_message
                    .lock()
                    .expect("agent message lock")
                    .clear();
                session.usage.lock().expect("usage lock").reset_for_turn();

                let request = {
                    let config = session.config.lock().expect("config lock");
                    let mut request = json!({
                        "threadId": session.session_id,
                        "input": input,
                        "model": config.model(),
                        // Always request a reasoning summary; the default
                        // "auto" can skip it on trivial turns.
                        "summary": "detailed",
                        "approvalPolicy": config.approval_policy(),
                        // Pushed every turn — codex remembers the last mode,
                        // so switching back from plan must be explicit.
                        "collaborationMode": config.collaboration_mode_for_turn(),
                    });
                    if let Some(effort) = config.effort() {
                        request["effort"] = json!(effort);
                    }
                    // Per-turn sandbox overrides are skipped on cloud, where a
                    // non-danger policy re-engages the unavailable
                    // linux-sandbox and panics.
                    if session.environment.as_deref() != Some("cloud") {
                        if let Some(sandbox_policy) = config.sandbox_policy() {
                            request["sandboxPolicy"] = sandbox_policy;
                        }
                        if let Some(profile) = config.permission_profile() {
                            request["activePermissionProfile"] = profile;
                        }
                    }
                    if let Some(schema) = &session.json_schema {
                        request["outputSchema"] = schema.clone();
                    }
                    request
                };

                let started = self.rpc().request("turn/start", request).await;
                if let Err(err) = started {
                    session
                        .turns
                        .lock()
                        .expect("turns lock")
                        .finish_prompt(generation);
                    return Err(RpcError::internal(format!("turn/start failed: {err}")));
                }
                let outcome = await_turn(rx).await;
                session
                    .turns
                    .lock()
                    .expect("turns lock")
                    .finish_prompt(generation);
                outcome
            }
        }
    }

    fn cancel(self: &Arc<Self>) {
        let Some(session) = self.current_session() else {
            return;
        };
        session.cancelled.store(true, Ordering::SeqCst);
        let driver = Arc::clone(self);
        tokio::spawn(async move {
            // turn/interrupt requires BOTH threadId and turnId (else -32600);
            // skip the RPC when no turn started, but still finalize through
            // the shared path so a cancelled turn emits the idle signal.
            let turn_id = session.turns.lock().expect("turns lock").mark_interrupted();
            if let Some(turn_id) = turn_id {
                let result = driver
                    .rpc()
                    .request(
                        "turn/interrupt",
                        json!({ "threadId": session.session_id, "turnId": turn_id }),
                    )
                    .await;
                if let Err(err) = result {
                    tracing::warn!(error = %err, "turn/interrupt failed");
                }
            }
            driver.finalize_turn(&session, "cancelled");
        });
    }

    fn set_config_option(self: &Arc<Self>, params: Value) -> Result<Value, RpcError> {
        let session = self.require_session()?;
        let mode_changed = session.config.lock().expect("config lock").set_option(
            params.get("configId").and_then(Value::as_str),
            params.get("value").and_then(Value::as_str),
        );
        // collaborationMode rides the next turn/start, so a mode switch only
        // needs current_mode_update here.
        if mode_changed {
            self.emit_current_mode(&session);
        }
        self.emit_config_options(&session);
        let options = session.config.lock().expect("config lock").options();
        Ok(json!({ "configOptions": options }))
    }

    // -- approvals (server-initiated requests) ----------------------------------

    async fn request_permission(
        &self,
        session: &CodexSession,
        options: Value,
        tool_call: Value,
    ) -> Result<Value, String> {
        self.peer()
            .request(
                client_methods::SESSION_REQUEST_PERMISSION,
                json!({
                    "sessionId": session.session_id,
                    "options": options,
                    "toolCall": tool_call,
                }),
            )
            .await
            .map_err(|err| err.message)
    }

    /// Simple yes/no approvals (`item/commandExecution/requestApproval`,
    /// `item/fileChange/requestApproval`): resolve to a `{decision}` envelope.
    async fn handle_simple_approval(
        self: &Arc<Self>,
        session: &Arc<CodexSession>,
        method: &str,
        params: &Value,
    ) -> Value {
        let is_file_change = method == requests::FILE_CHANGE_APPROVAL;
        let item_id = params.get("itemId").and_then(Value::as_str);
        let command = params.get("command").and_then(Value::as_str);

        // codex tells us which decisions are valid here. When it offers an
        // "approve and remember" decision, surface Allow-always.
        let available: Vec<&str> = params
            .get("available_decisions")
            .and_then(Value::as_array)
            .map(|decisions| decisions.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        let remember = available
            .iter()
            .find(|d| **d == "approved_execpolicy_amendment")
            .or_else(|| available.iter().find(|d| **d == "approved_for_session"))
            .copied();

        let title = command.unwrap_or(if is_file_change {
            "Apply file changes"
        } else {
            "Run command"
        });
        let tool_call_id = item_id.unwrap_or("codex-approval");

        // A known MCP call surfaces the real server/tool/args so the host
        // renders the proper MCP permission.
        let mcp = session.mcp.lock().expect("mcp lock").by_item_id(item_id);
        let tool_call = if let Some(mcp) = mcp {
            json!({
                "toolCallId": tool_call_id,
                "title": title,
                "kind": "other",
                "rawInput": mcp.args,
                "_meta": {
                    "posthog": {
                        "toolName": format!("mcp__{}__{}", mcp.server, mcp.tool),
                        "mcp": { "server": mcp.server, "tool": mcp.tool },
                    },
                },
            })
        } else if is_file_change {
            let mut tool_call = json!({
                "toolCallId": tool_call_id,
                "title": title,
                "kind": "edit",
                "locations": change_paths(params.get("changes"))
                    .iter()
                    .map(|path| json!({ "path": path }))
                    .collect::<Vec<_>>(),
            });
            if let Some(content) = diff_content(params.get("changes")) {
                tool_call["content"] = content;
            }
            tool_call
        } else {
            let mut tool_call = json!({
                "toolCallId": tool_call_id,
                "title": title,
                "kind": "execute",
            });
            if let Some(command) = command {
                tool_call["content"] = json!([{
                    "type": "content",
                    "content": { "type": "text", "text": command },
                }]);
            }
            tool_call
        };

        let mut options =
            vec![json!({ "optionId": "allow", "name": "Allow", "kind": "allow_once" })];
        if remember.is_some() {
            options.push(json!({
                "optionId": "allow_always",
                "name": if is_file_change {
                    "Allow for the rest of this session"
                } else {
                    "Allow and don't ask again"
                },
                "kind": "allow_always",
            }));
        }
        options.push(json!({ "optionId": "reject", "name": "Reject", "kind": "reject_once" }));
        options.push(json!({
            "optionId": "reject_with_feedback",
            "name": "No, and tell Codex what to do differently",
            "kind": "reject_once",
            "_meta": { "customInput": true },
        }));

        let response = match self
            .request_permission(session, json!(options), tool_call)
            .await
        {
            Ok(response) => response,
            Err(err) => {
                tracing::warn!(error = %err, "requestPermission failed; declining");
                return json!({ "decision": "decline" });
            }
        };

        let outcome = response.pointer("/outcome/outcome").and_then(Value::as_str);
        let option_id = response
            .pointer("/outcome/optionId")
            .and_then(Value::as_str);
        if outcome == Some("selected") {
            if option_id == Some("allow_always") {
                if let Some(remember) = remember {
                    // Echo codex's "approve and remember" decision so it
                    // applies the proposed amendment.
                    return json!({ "decision": remember });
                }
            }
            if option_id == Some("allow") {
                return json!({ "decision": "accept" });
            }
            if option_id == Some("reject_with_feedback") {
                // codex's response has no feedback field, so decline and
                // inject the guidance into the running turn (as its TUI does).
                let feedback = response
                    .pointer("/_meta/customInput")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|f| !f.is_empty())
                    .map(str::to_string);
                let active_turn_id = session
                    .turns
                    .lock()
                    .expect("turns lock")
                    .active_turn_id()
                    .map(str::to_string);
                if let (Some(feedback), Some(turn_id)) = (feedback, active_turn_id) {
                    let driver = Arc::clone(self);
                    let session = Arc::clone(session);
                    tokio::spawn(async move {
                        let steer = driver
                            .rpc()
                            .request(
                                "turn/steer",
                                json!({
                                    "threadId": session.session_id,
                                    "input": to_codex_input(&[json!({ "type": "text", "text": feedback })]),
                                    "expectedTurnId": turn_id,
                                }),
                            )
                            .await;
                        match steer {
                            Ok(result) => session
                                .turns
                                .lock()
                                .expect("turns lock")
                                .on_steered(result.get("turnId").and_then(Value::as_str)),
                            Err(err) => {
                                tracing::warn!(error = %err, "turn/steer (reject feedback) failed")
                            }
                        }
                    });
                }
                return json!({ "decision": "decline" });
            }
        }
        if outcome == Some("cancelled") {
            return json!({ "decision": "cancel" });
        }
        json!({ "decision": "decline" })
    }

    /// `item/tool/requestUserInput`: codex prompts one question per request;
    /// each is surfaced through requestPermission with `_meta.questions`.
    /// Cancel/failure leaves a well-formed empty answer.
    async fn handle_tool_user_input(&self, session: &CodexSession, params: &Value) -> Value {
        let mut answers = serde_json::Map::new();
        let questions = params
            .get("questions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        for question in &questions {
            let Some(question_id) = question.get("id").and_then(Value::as_str) else {
                continue;
            };
            answers.insert(question_id.to_string(), json!({ "answers": [] }));

            let question_options = question
                .get("options")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            // Free-text questions have no options; requestPermission can't
            // collect them.
            if question_options.is_empty() {
                continue;
            }
            let options: Vec<Value> = question_options
                .iter()
                .enumerate()
                .map(|(idx, opt)| {
                    let mut entry = json!({
                        "kind": "allow_once",
                        "name": opt.get("label").cloned().unwrap_or(Value::Null),
                        "optionId": format!("{OPTION_PREFIX}{idx}"),
                    });
                    if let Some(description) = opt
                        .get("description")
                        .and_then(Value::as_str)
                        .filter(|d| !d.trim().is_empty())
                    {
                        entry["_meta"] = json!({ "description": description });
                    }
                    entry
                })
                .collect();

            let meta_questions = json!([{
                "question": question.get("question"),
                "header": question.get("header"),
                "options": question_options
                    .iter()
                    .map(|opt| {
                        let mut entry = json!({ "label": opt.get("label") });
                        if let Some(description) = opt
                            .get("description")
                            .and_then(Value::as_str)
                            .filter(|d| !d.trim().is_empty())
                        {
                            entry["description"] = json!(description);
                        }
                        entry
                    })
                    .collect::<Vec<_>>(),
            }]);
            let item_id = params
                .get("itemId")
                .and_then(Value::as_str)
                .unwrap_or("item");

            let response = match self
                .request_permission(
                    session,
                    json!(options),
                    json!({
                        "toolCallId": format!("{item_id}:{question_id}"),
                        "title": question.get("question"),
                        "kind": "other",
                        "_meta": { "codeToolKind": "question", "questions": meta_questions },
                    }),
                )
                .await
            {
                Ok(response) => response,
                Err(err) => {
                    tracing::warn!(error = %err, "requestUserInput prompt failed; leaving empty");
                    continue;
                }
            };

            if response.pointer("/outcome/outcome").and_then(Value::as_str) != Some("selected") {
                continue;
            }
            let selected = response
                .pointer("/outcome/optionId")
                .and_then(Value::as_str)
                .and_then(|option_id| option_id.strip_prefix(OPTION_PREFIX))
                .and_then(|idx| idx.parse::<usize>().ok())
                .and_then(|idx| question_options.get(idx))
                .and_then(|opt| opt.get("label").and_then(Value::as_str));
            if let Some(label) = selected {
                answers.insert(question_id.to_string(), json!({ "answers": [label] }));
            }
        }

        json!({ "answers": answers })
    }

    /// `item/permissions/requestApproval`: grant only what was requested,
    /// scoped to this turn; anything else denies.
    async fn handle_permissions_approval(&self, session: &CodexSession, params: &Value) -> Value {
        let denied = json!({ "permissions": {}, "scope": "turn" });
        let response = match self
            .request_permission(
                session,
                json!([
                    { "kind": "allow_once", "name": "Allow", "optionId": "allow" },
                    { "kind": "reject_once", "name": "Reject", "optionId": "reject" },
                ]),
                json!({
                    "toolCallId": params.get("itemId").and_then(Value::as_str).unwrap_or("codex-permissions"),
                    "title": params
                        .get("reason")
                        .and_then(Value::as_str)
                        .unwrap_or("Grant additional permissions"),
                    "kind": "other",
                }),
            )
            .await
        {
            Ok(response) => response,
            Err(err) => {
                tracing::warn!(error = %err, "permissions approval prompt failed; denying");
                return denied;
            }
        };

        if response.pointer("/outcome/outcome").and_then(Value::as_str) == Some("selected")
            && response
                .pointer("/outcome/optionId")
                .and_then(Value::as_str)
                == Some("allow")
        {
            let mut granted = serde_json::Map::new();
            if let Some(network) = params
                .pointer("/permissions/network")
                .filter(|n| !n.is_null())
            {
                granted.insert("network".to_string(), network.clone());
            }
            if let Some(file_system) = params
                .pointer("/permissions/fileSystem")
                .filter(|f| !f.is_null())
            {
                granted.insert("fileSystem".to_string(), file_system.clone());
            }
            return json!({ "permissions": granted, "scope": "turn" });
        }
        denied
    }

    /// `mcpServer/elicitation/request`: accept/decline/cancel; a known
    /// in-flight MCP call renders the real operation.
    async fn handle_mcp_elicitation(&self, session: &CodexSession, params: &Value) -> Value {
        let declined = json!({ "action": "decline", "content": null, "_meta": null });
        let server_name = params
            .get("serverName")
            .and_then(Value::as_str)
            .unwrap_or("mcp");
        let title = params
            .get("message")
            .and_then(Value::as_str)
            .filter(|m| !m.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("{server_name} requests input"));

        let mcp = session.mcp.lock().expect("mcp lock").by_server(server_name);
        let tool_call = if let Some(mcp) = mcp {
            json!({
                "toolCallId": format!("{server_name}:elicitation"),
                "title": title,
                "kind": "other",
                "rawInput": mcp.args,
                "_meta": {
                    "posthog": {
                        "toolName": format!("mcp__{}__{}", mcp.server, mcp.tool),
                        "mcp": { "server": mcp.server, "tool": mcp.tool },
                    },
                },
            })
        } else {
            json!({
                "toolCallId": format!("{server_name}:elicitation"),
                "title": title,
                "kind": "other",
            })
        };

        let response = match self
            .request_permission(
                session,
                json!([
                    { "kind": "allow_once", "name": "Accept", "optionId": "accept" },
                    { "kind": "reject_once", "name": "Decline", "optionId": "decline" },
                ]),
                tool_call,
            )
            .await
        {
            Ok(response) => response,
            Err(err) => {
                tracing::warn!(error = %err, "elicitation prompt failed; declining");
                return declined;
            }
        };

        let outcome = response.pointer("/outcome/outcome").and_then(Value::as_str);
        if outcome == Some("cancelled") {
            return json!({ "action": "cancel", "content": null, "_meta": null });
        }
        if outcome == Some("selected")
            && response
                .pointer("/outcome/optionId")
                .and_then(Value::as_str)
                == Some("accept")
        {
            // No structured form UI over requestPermission; accept with empty
            // content.
            return json!({ "action": "accept", "content": {}, "_meta": null });
        }
        declined
    }
}

async fn await_turn(
    rx: tokio::sync::oneshot::Receiver<crate::turns::TurnResult>,
) -> Result<Value, RpcError> {
    match rx.await {
        Ok(Ok(reason)) => Ok(json!({ "stopReason": reason })),
        Ok(Err(error)) => Err(RpcError::internal(error)),
        Err(_) => Err(RpcError::internal(
            "codex app-server exited before the turn completed",
        )),
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
            methods::INITIALIZE => self.driver.initialize().await,
            methods::SESSION_NEW => self.driver.new_session(params).await,
            methods::SESSION_PROMPT => self.driver.prompt(params).await,
            methods::SESSION_SET_CONFIG_OPTION => self.driver.set_config_option(params),
            methods::SESSION_SET_MODE => {
                let mode = params.get("modeId").cloned().unwrap_or(Value::Null);
                self.driver
                    .set_config_option(json!({ "configId": "mode", "value": mode }))?;
                Ok(json!({}))
            }
            other => Err(RpcError::method_not_found(other)),
        }
    }

    async fn handle_notification(&self, method: &str, _params: Value) {
        match method {
            methods::SESSION_CANCEL => self.driver.cancel(),
            other => tracing::debug!(method = other, "Ignoring notification"),
        }
    }
}

// ---------------------------------------------------------------------------
// Approval handler (server-initiated requests from the app-server)

struct ApprovalHandler {
    driver: Arc<Driver>,
}

#[async_trait::async_trait]
impl ServerRequestHandler for ApprovalHandler {
    async fn handle_server_request(&self, method: &str, params: Value) -> Result<Value, String> {
        let Some(session) = self.driver.current_session() else {
            return Err("no active session".to_string());
        };
        // Every branch fails closed to the safe outcome — a dropped prompt
        // never silently grants access.
        let response = match method {
            requests::COMMAND_APPROVAL | requests::FILE_CHANGE_APPROVAL => {
                self.driver
                    .handle_simple_approval(&session, method, &params)
                    .await
            }
            requests::TOOL_USER_INPUT => {
                self.driver.handle_tool_user_input(&session, &params).await
            }
            requests::PERMISSIONS_APPROVAL => {
                self.driver
                    .handle_permissions_approval(&session, &params)
                    .await
            }
            requests::MCP_ELICITATION => {
                self.driver.handle_mcp_elicitation(&session, &params).await
            }
            other => {
                tracing::warn!(method = other, "Unrecognized server request; declining");
                json!({ "decision": "decline" })
            }
        };
        Ok(response)
    }
}
