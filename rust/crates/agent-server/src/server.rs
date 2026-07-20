//! The agent server: session lifecycle orchestration and command execution.
//!
//! Port of the `AgentServer` class in `agent-server.ts`. One active session
//! at a time; the agent runs as an ACP subprocess (see `adapter.rs`).
//! Covers session resume (native `_posthog/session/resume` with the summary
//! fallback), git handoff checkpoints, skill bundle installation, artifact
//! attachment loading, and the prewarmed-run auto-publish upgrade — see
//! `rust/README.md` for the full ported-surface inventory.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use posthog_acp::{ext, methods, Direction, LineTap, Peer, PeerHandle, PROTOCOL_VERSION};
use serde_json::{json, Value};
use tokio::process::Child;

use crate::adapter::{spawn_adapter, SidecarContext};
use crate::agent_version;
use crate::artifacts::{artifacts_by_id, missing_attachment_notice, ArtifactManager, BuiltPrompt};
use crate::bus::{notification_envelope, EventBus, SseSink};
use crate::checkpoint::{GitCheckpoint, HandoffTracker, LocalGitState};
use crate::client::{ClientHandler, SessionShared};
use crate::config::{AgentMode, RuntimeAdapter, ServerConfig};
use crate::error_class::{
    classify_agent_error, AgentErrorClassification, UPSTREAM_PROVIDER_FAILURE_MESSAGE,
};
use crate::gateway::{
    build_gateway_property_header_lines, resolve_gateway_product, resolve_llm_gateway_url,
    GatewayEnv,
};
use crate::ingest::{EventStreamSender, IngestConfig};
use crate::jwt::JwtPayload;
use crate::log_writer::SessionLogWriter;
use crate::posthog_api::{PostHogApiClient, Task, TaskRun};
use crate::resume::{self, ResumeState};
use crate::system_prompt::{build_session_system_prompt, detected_pr_context, PromptContext};

pub struct ActiveSession {
    pub payload: JwtPayload,
    pub acp_session_id: String,
    pub peer: Peer,
    pub shared: Arc<SessionShared>,
    child: Mutex<Option<Child>>,
    _peer_handle: PeerHandle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TurnPhase {
    Initial,
    Resume,
    Followup,
}

/// A prepared native resume: the prior run's ACP session continues under its
/// own id instead of being replayed as a summary prompt. `warm` means the
/// session state survived on disk (snapshot restore), so the workspace is
/// already current and no git checkpoint needs to be applied.
#[derive(Debug, Clone)]
struct NativeResume {
    session_id: String,
    warm: bool,
}

impl TurnPhase {
    fn as_str(&self) -> &'static str {
        match self {
            TurnPhase::Initial => "initial",
            TurnPhase::Resume => "resume",
            TurnPhase::Followup => "followup",
        }
    }
}

pub struct AgentServer {
    pub config: ServerConfig,
    pub bus: EventBus,
    pub api: Arc<PostHogApiClient>,
    session: tokio::sync::Mutex<Option<Arc<ActiveSession>>>,
    /// Guards against concurrent session initialization: `start()` kicks off
    /// auto-init while the event-relay's `GET /events` arrives — without the
    /// lock the second caller would create a duplicate session (and duplicate
    /// Slack messages), the exact race the TS server guards with
    /// `initializationPromise`.
    init_flight: tokio::sync::Mutex<()>,
    /// Gates bus broadcasts: the TS server drops SSE/ingest traffic until
    /// `this.session` is set (the ACP handshake is log-only), and so do we.
    session_active: AtomicBool,
    started_at: Instant,
    session_ready_boot_ms: Mutex<Option<u64>>,
    session_init_ms: Mutex<Option<u64>>,
    barrier_released_at: Mutex<Option<Instant>>,
    delivered_message_ids: Mutex<(VecDeque<String>, HashSet<String>)>,
    last_reported_branch: Mutex<Option<String>>,
    artifact_manager: Arc<ArtifactManager>,
    /// Prewarmed runs boot before the user's first message exists, so the
    /// boot-time --autoPublish flag can't carry the user's choice; it is
    /// resolved from run state when the first message arrives.
    prewarmed_run: AtomicBool,
    warm_auto_publish_resolved: AtomicBool,
    auto_publish_override: Mutex<Option<bool>>,
    resume_state: Mutex<Option<ResumeState>>,
    native_resume: Mutex<Option<NativeResume>>,
}

impl AgentServer {
    pub fn new(config: ServerConfig) -> Arc<Self> {
        let api = Arc::new(PostHogApiClient::new(
            &config.api_url,
            config.project_id,
            &config.api_key,
            &agent_version(),
        ));

        let ingest = config.event_ingest_token.as_ref().map(|token| {
            let mut ingest_config = IngestConfig::new(
                &config.api_url,
                config.project_id,
                &config.task_id,
                &config.run_id,
                token,
            );
            ingest_config.event_ingest_base_url = config.event_ingest_base_url.clone();
            ingest_config.keep_proxy_stream_open =
                config.event_ingest_keep_stream_open.unwrap_or(false);
            if let Some(window_ms) = config.event_ingest_stream_window_ms {
                ingest_config.stream_window = Duration::from_millis(window_ms);
            }
            EventStreamSender::spawn(ingest_config)
        });

        Arc::new(Self {
            bus: EventBus::new(ingest),
            api,
            config,
            session: tokio::sync::Mutex::new(None),
            init_flight: tokio::sync::Mutex::new(()),
            session_active: AtomicBool::new(false),
            started_at: Instant::now(),
            session_ready_boot_ms: Mutex::new(None),
            session_init_ms: Mutex::new(None),
            barrier_released_at: Mutex::new(None),
            delivered_message_ids: Mutex::new((VecDeque::new(), HashSet::new())),
            last_reported_branch: Mutex::new(None),
            artifact_manager: Arc::new(ArtifactManager::default()),
            prewarmed_run: AtomicBool::new(false),
            warm_auto_publish_resolved: AtomicBool::new(false),
            auto_publish_override: Mutex::new(None),
            resume_state: Mutex::new(None),
            native_resume: Mutex::new(None),
        })
    }

    pub async fn session(&self) -> Option<Arc<ActiveSession>> {
        self.session.lock().await.clone()
    }

    pub fn health(&self) -> Value {
        let mut health = json!({
            "status": "ok",
            "hasSession": self.session_active.load(Ordering::SeqCst),
        });
        if let Some(boot_ms) = *self.session_ready_boot_ms.lock().expect("boot lock") {
            health["bootMs"] = json!(boot_ms);
        }
        if let Some(init_ms) = *self.session_init_ms.lock().expect("init lock") {
            health["sessionInitMs"] = json!(init_ms);
        }
        health
    }

    /// `autoInitializeSession`: synthesize a payload from config and
    /// initialize without a client attached.
    pub async fn auto_initialize_session(self: &Arc<Self>) -> anyhow::Result<()> {
        let payload = JwtPayload {
            task_id: self.config.task_id.clone(),
            run_id: self.config.run_id.clone(),
            team_id: self.config.project_id,
            user_id: 0, // System-initiated
            distinct_id: "agent-server".to_string(),
            mode: self.config.mode.as_str().to_string(),
        };
        self.initialize_session(payload, None).await
    }

    /// `initializeSession` + `_doInitializeSession`.
    pub async fn initialize_session(
        self: &Arc<Self>,
        payload: JwtPayload,
        sse: Option<SseSink>,
    ) -> anyhow::Result<()> {
        let _flight = self.init_flight.lock().await;

        // A concurrent caller may have initialized while we waited: attach
        // and reuse rather than double-initializing.
        if let Some(existing) = self.session().await {
            if existing.payload.run_id == payload.run_id {
                if let Some(sse) = sse {
                    existing
                        .shared
                        .has_desktop_connected
                        .store(true, Ordering::SeqCst);
                    self.bus.attach_sse(sse);
                }
                return Ok(());
            }
            self.cleanup_session(false).await;
        }

        tracing::debug!(run_id = %payload.run_id, task_id = %payload.task_id, "Initializing session");

        let (pre_task_run, pre_task) = tokio::join!(
            self.api.get_task_run(&payload.task_id, &payload.run_id),
            self.api.get_task(&payload.task_id),
        );
        let pre_task_run: Option<TaskRun> = pre_task_run
            .map_err(
                |err| tracing::debug!(error = %err, "Failed to fetch task run for session context"),
            )
            .ok();
        let pre_task: Option<Task> = pre_task
            .map_err(
                |err| tracing::debug!(error = %err, "Failed to fetch task for session context"),
            )
            .ok();

        let gateway_env =
            self.configure_environment(pre_task.as_ref(), pre_task_run.as_ref(), &payload);

        let pr_url = pre_task_run
            .as_ref()
            .and_then(|run| run.state_string("slack_notified_pr_url"));
        let slack_thread_url = pre_task_run
            .as_ref()
            .and_then(|run| run.state_string("slack_thread_url"));
        let inbox_report_url = pre_task.as_ref().and_then(|task| {
            task.signal_report.as_ref().map(|report_id| {
                format!(
                    "{}/project/{}/inbox/{report_id}",
                    self.config.api_url.trim_end_matches('/'),
                    self.config.project_id
                )
            })
        });

        let log_writer =
            SessionLogWriter::new(Arc::clone(&self.api), &payload.task_id, &payload.run_id);

        let initial_permission_mode = pre_task_run
            .as_ref()
            .and_then(|run| run.state_string("initial_permission_mode"))
            .unwrap_or_else(|| match self.config.runtime_adapter {
                RuntimeAdapter::Codex => "auto".to_string(),
                RuntimeAdapter::Claude => "bypassPermissions".to_string(),
            });

        let (checkpoint_tx, checkpoint_rx) = tokio::sync::mpsc::unbounded_channel();
        let shared = Arc::new(SessionShared {
            config: self.config.clone(),
            api: Arc::clone(&self.api),
            bus: self.bus.clone(),
            log_writer: log_writer.clone(),
            permission_mode: Mutex::new(initial_permission_mode.clone()),
            has_desktop_connected: AtomicBool::new(sse.is_some()),
            adapter_emitted_turn_complete: AtomicBool::new(false),
            question_relayed_to_slack: AtomicBool::new(false),
            pending_permissions: Mutex::new(HashMap::new()),
            detected_pr_url: Mutex::new(pr_url.clone()),
            evaluated_pr_urls: Mutex::new(HashSet::new()),
            pending_handoff_git_state: Mutex::new(None),
            checkpoint_requests: checkpoint_tx,
        });

        // Spawn the agent subprocess and wire the ACP peer. The tap mirrors
        // the TS double-tap: every line (both directions) is persisted to the
        // session log, and broadcast to SSE/ingest once the session is live.
        let spawned = spawn_adapter(&SidecarContext {
            config: &self.config,
            gateway_env: &gateway_env,
        })?;

        let tap: LineTap = {
            let server = Arc::downgrade(self);
            let shared = Arc::clone(&shared);
            Arc::new(
                move |_direction: Direction, line: &str, parsed: Option<&Value>| {
                    let Some(server) = server.upgrade() else {
                        return;
                    };
                    if server.session_active.load(Ordering::SeqCst) {
                        if parsed.and_then(|v| v.get("method")).and_then(Value::as_str)
                            == Some(ext::TURN_COMPLETE)
                        {
                            shared
                                .adapter_emitted_turn_complete
                                .store(true, Ordering::SeqCst);
                        }
                        server.bus.broadcast_notification_line(line);
                    }
                    // Log persistence is unconditional (the TS inner tap runs from
                    // connection creation, before the session is registered).
                    match parsed {
                        Some(parsed) => {
                            let writer = shared.log_writer.clone();
                            let message = parsed.clone();
                            tokio::spawn(async move { writer.append(&message).await });
                        }
                        None => {
                            let writer = shared.log_writer.clone();
                            let line = line.to_string();
                            tokio::spawn(async move {
                                if let Ok(message) = serde_json::from_str::<Value>(&line) {
                                    writer.append(&message).await;
                                }
                            });
                        }
                    }
                },
            )
        };

        let handler = Arc::new(ClientHandler {
            shared: Arc::clone(&shared),
        });
        let (peer, peer_handle) = Peer::spawn(spawned.stdout, spawned.stdin, handler, Some(tap));

        peer.request(
            methods::INITIALIZE,
            json!({ "protocolVersion": PROTOCOL_VERSION, "clientCapabilities": {} }),
        )
        .await
        .map_err(|err| anyhow::anyhow!("ACP initialize failed: {err}"))?;

        self.wait_for_repo_ready().await;

        self.prewarmed_run.store(
            pre_task_run
                .as_ref()
                .and_then(|run| run.state_bool("prewarmed"))
                .unwrap_or(false),
            Ordering::SeqCst,
        );
        self.warm_auto_publish_resolved
            .store(false, Ordering::SeqCst);
        *self.auto_publish_override.lock().expect("override lock") = None;
        *self.resume_state.lock().expect("resume lock") = None;
        *self.native_resume.lock().expect("native resume lock") = None;

        // Install pending skill bundles before session/new so `/skill` prompts
        // can resolve immediately.
        {
            let pending_ids: Vec<String> = pre_task_run
                .as_ref()
                .and_then(|run| run.state.as_ref())
                .and_then(|state| state.get("pending_user_artifact_ids"))
                .and_then(Value::as_array)
                .map(|ids| {
                    ids.iter()
                        .filter_map(Value::as_str)
                        .filter(|id| !id.trim().is_empty())
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            let manifest: Vec<Value> = pre_task_run
                .as_ref()
                .and_then(|run| run.artifacts.as_ref())
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let pending = artifacts_by_id(&manifest, &pending_ids, false);
            if !pending.is_empty() {
                self.artifact_manager
                    .install_skill_bundles(
                        &self.api,
                        &self.workspace_root(),
                        &payload.task_id,
                        &payload.run_id,
                        &pending,
                    )
                    .await;
            }
        }

        let prompt_ctx = PromptContext {
            config: &self.config,
            pr_url: pr_url.as_deref(),
            slack_thread_url: slack_thread_url.as_deref(),
            inbox_report_url: inbox_report_url.as_deref(),
        };
        let session_cwd = self
            .config
            .repository_path
            .clone()
            .unwrap_or_else(|| "/tmp/workspace".to_string());
        let mut session_meta = json!({
            "sessionId": payload.run_id,
            "taskRunId": payload.run_id,
            "taskId": payload.task_id,
            "environment": "cloud",
            "systemPrompt": build_session_system_prompt(&prompt_ctx),
            "jsonSchema": pre_task.as_ref().and_then(|t| t.json_schema.clone()).unwrap_or(Value::Null),
            "permissionMode": initial_permission_mode.clone(),
        });
        if let Some(model) = &self.config.model {
            session_meta["model"] = json!(model);
        }
        if let Some(domains) = &self.config.allowed_domains {
            session_meta["allowedDomains"] = json!(domains);
        }
        if let Some(base_branch) = &self.config.base_branch {
            session_meta["baseBranch"] = json!(base_branch);
        }
        if let Some(claude_code_meta) = self.build_claude_code_session_meta() {
            session_meta["claudeCode"] = claude_code_meta;
        }

        let native_resume = self
            .prepare_native_resume(
                &payload,
                pre_task_run.as_ref(),
                &session_cwd,
                &initial_permission_mode,
            )
            .await;
        let mut acp_session_id: Option<String> = None;
        if let Some(native) = &native_resume {
            let mut resume_meta = session_meta.clone();
            resume_meta["sessionId"] = json!(native.session_id);
            match peer
                .request(
                    ext::SESSION_RESUME,
                    json!({
                        "sessionId": native.session_id,
                        "cwd": session_cwd,
                        "mcpServers": self.config.mcp_servers,
                        "_meta": resume_meta,
                    }),
                )
                .await
            {
                Ok(_) => {
                    acp_session_id = Some(native.session_id.clone());
                    *self.native_resume.lock().expect("native resume lock") = Some(native.clone());
                    tracing::debug!(
                        acp_session_id = %native.session_id,
                        run_id = %payload.run_id,
                        warm = native.warm,
                        "ACP session resumed"
                    );
                }
                Err(err) => {
                    // resume_state is still loaded, so the summary resume path
                    // takes over on the fresh session below.
                    tracing::warn!(
                        session_id = %native.session_id,
                        error = %err,
                        "Native resume failed; starting a fresh session"
                    );
                }
            }
        }
        let acp_session_id = match acp_session_id {
            Some(id) => id,
            None => {
                let session_response = peer
                    .request(
                        methods::SESSION_NEW,
                        json!({
                            "cwd": session_cwd,
                            "mcpServers": self.config.mcp_servers,
                            "_meta": session_meta,
                        }),
                    )
                    .await
                    .map_err(|err| anyhow::anyhow!("ACP session/new failed: {err}"))?;
                let id = session_response
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow::anyhow!("session/new returned no sessionId"))?
                    .to_string();
                tracing::debug!(acp_session_id = %id, run_id = %payload.run_id, "ACP session created");
                id
            }
        };

        let session = Arc::new(ActiveSession {
            payload: payload.clone(),
            acp_session_id: acp_session_id.clone(),
            peer,
            shared: Arc::clone(&shared),
            child: Mutex::new(Some(spawned.child)),
            _peer_handle: peer_handle,
        });
        *self.session.lock().await = Some(Arc::clone(&session));
        self.session_active.store(true, Ordering::SeqCst);
        self.spawn_checkpoint_worker(Arc::clone(&session), checkpoint_rx);
        if let Some(sse) = sse {
            self.bus.attach_sse(sse);
        }

        let boot_ms = self.started_at.elapsed().as_millis() as u64;
        let init_ms = self
            .barrier_released_at
            .lock()
            .expect("barrier lock")
            .map(|at| at.elapsed().as_millis() as u64)
            .unwrap_or(0);
        *self.session_ready_boot_ms.lock().expect("boot lock") = Some(boot_ms);
        *self.session_init_ms.lock().expect("init lock") = Some(init_ms);
        tracing::debug!(
            boot_ms,
            session_init_ms = init_ms,
            "Session initialized successfully"
        );
        tracing::debug!(version = %agent_version(), "Agent version");

        // Lifecycle handshake: clients gate "agent is ready" on run_started.
        let run_started = json!({
            "jsonrpc": "2.0",
            "method": ext::RUN_STARTED,
            "params": {
                "sessionId": acp_session_id,
                "runId": payload.run_id,
                "taskId": payload.task_id,
                "agentVersion": agent_version(),
            },
        });
        self.broadcast_and_log(&session, &run_started).await;

        // Mirror the "agent" setup step onto the ingest leg the client reads.
        let agent_started_progress = json!({
            "jsonrpc": "2.0",
            "method": ext::PROGRESS,
            "params": {
                "group": format!("setup:{}", payload.run_id),
                "step": "agent",
                "status": "completed",
                "label": "Started agent",
            },
        });
        self.broadcast_and_log(&session, &agent_started_progress)
            .await;

        // Signal in_progress so the UI can start polling for updates.
        {
            let server = Arc::clone(self);
            let payload = payload.clone();
            tokio::spawn(async move {
                if let Err(err) = server
                    .api
                    .update_task_run(
                        &payload.task_id,
                        &payload.run_id,
                        json!({"status": "in_progress"}),
                    )
                    .await
                {
                    tracing::debug!(error = %err, "Failed to set task run to in_progress");
                }
            });
        }

        // The initial turn can run for minutes; it must not hold the init
        // flight lock (the TS server sets `this.session` before awaiting it,
        // with the same effect for concurrent /events attaches).
        {
            let server = Arc::clone(self);
            let session = Arc::clone(&session);
            tokio::spawn(async move {
                server
                    .send_initial_task_message(&session, pre_task, pre_task_run)
                    .await;
            });
        }

        Ok(())
    }

    /// `configureEnvironment`: task-scoped gateway config for the adapter.
    fn configure_environment(
        &self,
        task: Option<&Task>,
        task_run: Option<&TaskRun>,
        payload: &JwtPayload,
    ) -> GatewayEnv {
        let is_internal = task.map(|t| t.internal).unwrap_or(false);
        let origin_product = task.and_then(|t| t.origin_product.clone());
        let product = resolve_gateway_product(is_internal, origin_product.as_deref());
        let gateway_url = resolve_llm_gateway_url(
            self.config.llm_gateway_url_override.as_deref(),
            &self.config.api_url,
            product,
        );
        let openai_base_url = if gateway_url.ends_with("/v1") {
            gateway_url.clone()
        } else {
            format!("{gateway_url}/v1")
        };

        let task_user_id = if payload.user_id != 0 {
            Some(payload.user_id.to_string())
        } else {
            task.and_then(|t| t.created_by.as_ref())
                .and_then(|u| u.get("id"))
                .and_then(Value::as_i64)
                .map(|id| id.to_string())
        };

        // Forwarded as `x-posthog-property-*` headers so the gateway lifts
        // them onto the $ai_generation event.
        let custom_headers = build_gateway_property_header_lines(&[
            ("task_origin_product", origin_product),
            ("task_internal", Some(is_internal.to_string())),
            (
                "signal_report_id",
                task.and_then(|t| t.signal_report.clone()),
            ),
            (
                "ai_stage",
                task_run.and_then(|run| run.state_string("ai_stage")),
            ),
            ("task_id", Some(payload.task_id.clone())),
            ("task_run_id", Some(payload.run_id.clone())),
            ("task_user_id", task_user_id),
            ("task_title", task.and_then(|t| t.title.clone())),
        ]);

        GatewayEnv {
            anthropic_base_url: gateway_url,
            anthropic_auth_token: self.config.api_key.clone(),
            openai_base_url,
            openai_api_key: self.config.api_key.clone(),
            anthropic_custom_headers: custom_headers,
            posthog_project_id: self.config.project_id.to_string(),
        }
    }

    /// Reasoning effort and plugins are independent: effort must reach Claude
    /// even when no plugins are set.
    fn build_claude_code_session_meta(&self) -> Option<Value> {
        let plugins = self
            .config
            .claude_code
            .as_ref()
            .and_then(|c| c.plugins.clone())
            .filter(|p| !p.is_empty());
        let effort = match self.config.runtime_adapter {
            RuntimeAdapter::Claude => self.config.reasoning_effort.clone(),
            RuntimeAdapter::Codex => None,
        };
        if plugins.is_none() && effort.is_none() {
            return None;
        }
        let mut options = serde_json::Map::new();
        if let Some(plugins) = plugins {
            options.insert("plugins".to_string(), json!(plugins));
        }
        if let Some(effort) = effort {
            options.insert("effort".to_string(), json!(effort));
        }
        Some(json!({ "options": Value::Object(options) }))
    }

    /// `waitForRepoReady`: block session creation on the clone barrier.
    async fn wait_for_repo_ready(&self) {
        const REPO_READY_TIMEOUT: Duration = Duration::from_secs(5 * 60);
        const POLL: Duration = Duration::from_millis(100);

        let Some(ready_file) = self.config.repo_ready_file.clone() else {
            *self.barrier_released_at.lock().expect("barrier lock") = Some(Instant::now());
            return;
        };

        let started = Instant::now();
        loop {
            if tokio::fs::try_exists(&ready_file).await.unwrap_or(false) {
                tracing::debug!(
                    ready_file,
                    waited_ms = started.elapsed().as_millis() as u64,
                    "Repo-ready barrier released"
                );
                break;
            }
            if started.elapsed() > REPO_READY_TIMEOUT {
                tracing::warn!(
                    ready_file,
                    waited_ms = started.elapsed().as_millis() as u64,
                    "Repo-ready barrier timed out; proceeding"
                );
                break;
            }
            tokio::time::sleep(POLL).await;
        }
        *self.barrier_released_at.lock().expect("barrier lock") = Some(Instant::now());
    }

    async fn broadcast_and_log(&self, session: &ActiveSession, notification: &Value) {
        self.bus
            .broadcast(notification_envelope(&notification.to_string()));
        session
            .shared
            .log_writer
            .append_notification(notification)
            .await;
    }

    /// `sendInitialTaskMessage`: resume takes precedence, then the pending
    /// user prompt, the run-state prompt override, and the task description.
    async fn send_initial_task_message(
        self: &Arc<Self>,
        session: &Arc<ActiveSession>,
        pre_task: Option<Task>,
        pre_task_run: Option<TaskRun>,
    ) {
        let payload = &session.payload;

        let task_run = match pre_task_run {
            Some(run) => Some(run),
            None => self
                .api
                .get_task_run(&payload.task_id, &payload.run_id)
                .await
                .ok(),
        };

        // Native resume prepared during session init: the agent holds the
        // prior conversation, so just continue the turn.
        if self
            .native_resume
            .lock()
            .expect("native resume lock")
            .is_some()
        {
            self.send_resume_continuation(session, task_run.as_ref())
                .await;
            return;
        }

        // Summary resume: rebuild the prior run's conversation from its log
        // (already loaded when a native resume was attempted but fell back).
        let preloaded_state = self.resume_state.lock().expect("resume lock").clone();
        if let Some(state) = preloaded_state {
            if !state.conversation.is_empty() {
                self.send_resume_message(session, task_run.as_ref()).await;
                return;
            }
            tracing::debug!("Preloaded resume log empty; starting fresh");
        } else if let Some(resume_run_id) = self.resume_run_id(task_run.as_ref()) {
            match resume::resume_from_log(&self.api, &payload.task_id, &resume_run_id).await {
                Ok(state) if !state.conversation.is_empty() => {
                    tracing::debug!(
                        resume_run_id,
                        turns = state.conversation.len(),
                        has_checkpoint = state.latest_git_checkpoint.is_some(),
                        "Resume state loaded"
                    );
                    *self.resume_state.lock().expect("resume lock") = Some(state);
                    self.send_resume_message(session, task_run.as_ref()).await;
                    return;
                }
                Ok(_) => {
                    tracing::debug!(resume_run_id, "Resume log empty; starting fresh");
                }
                Err(err) => {
                    tracing::debug!(error = %err, "Failed to load resume state, starting fresh");
                }
            }
        }

        let task = match pre_task {
            Some(task) => Some(task),
            None => self.api.get_task(&payload.task_id).await.ok(),
        };

        // A prewarmed run gets its first message forwarded as a user_message
        // command on activation; building one from task.description here too
        // would deliver it twice.
        let prewarmed = self.prewarmed_run.load(Ordering::SeqCst);

        let pending_prompt = self.pending_user_prompt(task_run.as_ref()).await;
        let initial_prompt_override = task_run
            .as_ref()
            .and_then(|run| run.state_string("initial_prompt_override"))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let built: Option<BuiltPrompt> = if let Some(pending) = pending_prompt {
            Some(pending)
        } else if let Some(override_text) = initial_prompt_override {
            Some(BuiltPrompt {
                prompt: vec![json!({ "type": "text", "text": override_text })],
                meta: None,
            })
        } else {
            match task.as_ref().and_then(|t| t.description.clone()) {
                Some(description) if !description.is_empty() && !prewarmed => Some(BuiltPrompt {
                    prompt: vec![json!({ "type": "text", "text": description })],
                    meta: None,
                }),
                _ => None,
            }
        };

        let Some(built) = built else {
            tracing::debug!(
                prewarmed,
                "No initial prompt to send (prewarmed run or empty task description)"
            );
            return;
        };

        session.shared.log_writer.reset_turn_messages().await;

        let mut request = json!({ "sessionId": session.acp_session_id, "prompt": built.prompt });
        if let Some(meta) = built.meta {
            request["_meta"] = meta;
        }
        let result = session.peer.request(methods::SESSION_PROMPT, request).await;

        match result {
            Ok(response) => {
                let stop_reason = response
                    .get("stopReason")
                    .and_then(Value::as_str)
                    .unwrap_or("end_turn")
                    .to_string();
                tracing::debug!(stop_reason, "Initial task message completed");
                self.clear_pending_initial_prompt_state(payload, task_run.as_ref())
                    .await;
                self.finish_turn(session, &stop_reason, true).await;
            }
            Err(err) => {
                tracing::error!(error = %err, "Failed to send initial task message");
                session.shared.log_writer.flush().await;
                self.handle_turn_failure(
                    session,
                    TurnPhase::Initial,
                    &err.message,
                    err.data.as_ref(),
                )
                .await;
            }
        }
    }

    /// `prepareNativeResume`: when the prior run's ACP session can be
    /// continued natively — the Claude session JSONL exists or can be
    /// hydrated from the prior run's log, or codex thread state survived a
    /// snapshot restore — return the session to resume. None falls back to
    /// the summary resume path (which reuses the resume state loaded here).
    async fn prepare_native_resume(
        &self,
        payload: &JwtPayload,
        task_run: Option<&TaskRun>,
        cwd: &str,
        permission_mode: &str,
    ) -> Option<NativeResume> {
        let resume_run_id = self.resume_run_id(task_run)?;

        if self.resume_state.lock().expect("resume lock").is_none() {
            match resume::resume_from_log(&self.api, &payload.task_id, &resume_run_id).await {
                Ok(state) => {
                    *self.resume_state.lock().expect("resume lock") = Some(state);
                }
                Err(err) => {
                    tracing::debug!(error = %err, resume_run_id, "Failed to load resume state");
                    return None;
                }
            }
        }

        let (prior_session_id, conversation) = {
            let state = self.resume_state.lock().expect("resume lock");
            let state = state.as_ref()?;
            (state.session_id.clone(), state.conversation.clone())
        };
        let Some(prior_session_id) = prior_session_id else {
            tracing::debug!(
                resume_run_id,
                "No prior session id; using summary resume fallback"
            );
            return None;
        };

        match self.config.runtime_adapter {
            RuntimeAdapter::Codex => {
                // Codex owns thread persistence in CODEX_HOME (the ACP
                // sessionId is the codex thread id). The rollout only
                // survives a snapshot restart — there is no cold hydration
                // equivalent, so a fresh sandbox keeps the summary fallback
                // while a warm one resumes the thread natively.
                if !resume::has_codex_thread_state(&prior_session_id) {
                    tracing::debug!(
                        resume_run_id,
                        prior_session_id,
                        "No codex thread state on disk; using summary resume fallback"
                    );
                    return None;
                }
                tracing::debug!(prior_session_id, "Native codex resume prepared");
                Some(NativeResume {
                    session_id: prior_session_id,
                    warm: true,
                })
            }
            RuntimeAdapter::Claude => {
                let warm = posthog_agent_tools::session_jsonl::get_session_jsonl_path(
                    &prior_session_id,
                    cwd,
                )
                .exists();
                let has_session = resume::hydrate_session_jsonl(
                    &conversation,
                    &resume::HydrationConfig {
                        session_id: &prior_session_id,
                        cwd,
                        model: self.config.model.as_deref(),
                        permission_mode,
                    },
                );
                if !has_session {
                    tracing::debug!(
                        resume_run_id,
                        prior_session_id,
                        "No session JSONL to resume; using summary fallback"
                    );
                    return None;
                }
                tracing::debug!(prior_session_id, warm, "Native resume prepared");
                Some(NativeResume {
                    session_id: prior_session_id,
                    warm,
                })
            }
        }
    }

    /// `sendResumeContinuation`: the native-resume first turn — the agent
    /// already holds the conversation, so no summary is replayed; a warm
    /// session skips the git checkpoint too (the workspace survived).
    async fn send_resume_continuation(
        self: &Arc<Self>,
        session: &Arc<ActiveSession>,
        task_run: Option<&TaskRun>,
    ) {
        let payload = &session.payload;
        let native = self
            .native_resume
            .lock()
            .expect("native resume lock")
            .take();
        let Some(native) = native else { return };
        let state = self.resume_state.lock().expect("resume lock").take();

        let checkpoint_applied = if native.warm {
            false
        } else {
            self.apply_resume_git_checkpoint(
                payload,
                state
                    .as_ref()
                    .and_then(|s| s.latest_git_checkpoint.as_ref()),
            )
            .await
        };

        let pending_prompt = self.pending_user_prompt(task_run).await;
        let (prompt, meta): (Vec<Value>, Option<Value>) = match pending_prompt {
            Some(pending) if !pending.prompt.is_empty() => (pending.prompt, pending.meta),
            _ => (
                vec![json!({
                    "type": "text",
                    "text": "Continue from where you left off. The user is waiting for your response.",
                })],
                None,
            ),
        };

        tracing::debug!(
            session_id = %native.session_id,
            warm = native.warm,
            checkpoint_applied,
            "Sending resume continuation"
        );

        session.shared.log_writer.reset_turn_messages().await;
        let mut request = json!({ "sessionId": session.acp_session_id, "prompt": prompt });
        if let Some(meta) = meta {
            request["_meta"] = meta;
        }
        let result = session.peer.request(methods::SESSION_PROMPT, request).await;

        match result {
            Ok(response) => {
                let stop_reason = response
                    .get("stopReason")
                    .and_then(Value::as_str)
                    .unwrap_or("end_turn")
                    .to_string();
                tracing::debug!(stop_reason, "Resume continuation completed");
                self.clear_pending_initial_prompt_state(payload, task_run)
                    .await;
                self.finish_turn(session, &stop_reason, true).await;
            }
            Err(err) => {
                tracing::error!(error = %err, "Failed to send resume continuation");
                session.shared.log_writer.flush().await;
                self.handle_turn_failure(
                    session,
                    TurnPhase::Resume,
                    &err.message,
                    err.data.as_ref(),
                )
                .await;
            }
        }
    }

    /// `getResumeRunId`: env var takes precedence over run state.
    fn resume_run_id(&self, task_run: Option<&TaskRun>) -> Option<String> {
        if let Some(env_run_id) = &self.config.resume_run_id {
            return Some(env_run_id.clone());
        }
        task_run
            .and_then(|run| run.state_string("resume_from_run_id"))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    }

    /// `sendResumeMessage`: apply the latest git checkpoint (best-effort) and
    /// prompt with the summarized prior conversation.
    async fn send_resume_message(
        self: &Arc<Self>,
        session: &Arc<ActiveSession>,
        task_run: Option<&TaskRun>,
    ) {
        let payload = &session.payload;
        let state = self.resume_state.lock().expect("resume lock").take();
        let Some(state) = state else { return };

        let conversation_summary = resume::format_conversation_for_resume(&state.conversation);
        let checkpoint_applied = self
            .apply_resume_git_checkpoint(payload, state.latest_git_checkpoint.as_ref())
            .await;

        let checkpoint_context = if checkpoint_applied {
            "The workspace environment (all files, packages, and code changes) has been fully restored from the latest checkpoint."
        } else {
            "No additional git checkpoint was applied before resuming. Use the current workspace contents together with the preserved conversation history below."
        };

        let pending_prompt = self.pending_user_prompt(task_run).await;
        fn hidden_text_block(text: String) -> Value {
            json!({ "type": "text", "text": text, "_meta": { "ui": { "hidden": true } } })
        }
        let (prompt, meta): (Vec<Value>, Option<Value>) = match pending_prompt {
            Some(pending) if !pending.prompt.is_empty() => {
                let mut blocks = vec![hidden_text_block(format!(
                    "You are resuming a previous conversation. {checkpoint_context}\n\nHere is the conversation history from the previous session:\n\n{conversation_summary}\n\nThe user has sent a new message:\n\n"
                ))];
                blocks.extend(pending.prompt);
                blocks.push(hidden_text_block(
                    "\n\nRespond to the user's new message above. You have full context from the previous session."
                        .to_string(),
                ));
                (blocks, pending.meta)
            }
            _ => (
                vec![hidden_text_block(format!(
                    "You are resuming a previous conversation. {checkpoint_context}\n\nHere is the conversation history from the previous session:\n\n{conversation_summary}\n\nContinue from where you left off. The user is waiting for your response."
                ))],
                None,
            ),
        };

        tracing::debug!(
            turns = state.conversation.len(),
            checkpoint_applied,
            "Sending resume message"
        );

        session.shared.log_writer.reset_turn_messages().await;
        let mut request = json!({ "sessionId": session.acp_session_id, "prompt": prompt });
        if let Some(meta) = meta {
            request["_meta"] = meta;
        }
        let result = session.peer.request(methods::SESSION_PROMPT, request).await;

        match result {
            Ok(response) => {
                let stop_reason = response
                    .get("stopReason")
                    .and_then(Value::as_str)
                    .unwrap_or("end_turn")
                    .to_string();
                tracing::debug!(stop_reason, "Resume message completed");
                self.clear_pending_initial_prompt_state(payload, task_run)
                    .await;
                self.finish_turn(session, &stop_reason, true).await;
            }
            Err(err) => {
                tracing::error!(error = %err, "Failed to send resume message");
                session.shared.log_writer.flush().await;
                self.handle_turn_failure(
                    session,
                    TurnPhase::Resume,
                    &err.message,
                    err.data.as_ref(),
                )
                .await;
            }
        }
    }

    /// `applyResumeGitCheckpoint` — best-effort; resume proceeds without it.
    async fn apply_resume_git_checkpoint(
        &self,
        payload: &JwtPayload,
        checkpoint_params: Option<&Value>,
    ) -> bool {
        let (Some(params), Some(repo)) = (checkpoint_params, &self.config.repository_path) else {
            return false;
        };
        let Some(checkpoint) = GitCheckpoint::from_event_params(params) else {
            return false;
        };
        let tracker = HandoffTracker {
            repository_path: repo,
            task_id: &payload.task_id,
            run_id: &payload.run_id,
            api: &self.api,
        };
        match tracker.apply_from_handoff(&checkpoint).await {
            Ok(()) => {
                tracing::debug!(branch = ?checkpoint.branch, head = ?checkpoint.head, "Git checkpoint applied");
                true
            }
            Err(err) => {
                tracing::warn!(error = %err, branch = ?checkpoint.branch, "Failed to apply git checkpoint");
                false
            }
        }
    }

    /// `getPendingUserPrompt`: the message + attachments queued in run state.
    async fn pending_user_prompt(&self, task_run: Option<&TaskRun>) -> Option<BuiltPrompt> {
        let task_run = task_run?;
        let state = task_run.state.as_ref()?;
        let message = state
            .get("pending_user_message")
            .and_then(Value::as_str)
            .map(str::to_string);
        let artifact_ids: Vec<String> = state
            .get("pending_user_artifact_ids")
            .and_then(Value::as_array)
            .map(|ids| {
                ids.iter()
                    .filter_map(Value::as_str)
                    .filter(|id| !id.trim().is_empty())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        if message.is_none() && artifact_ids.is_empty() {
            return None;
        }

        // The manifest can momentarily lag the pending ids; refetch once
        // before treating an attachment as lost.
        let mut manifest: Vec<Value> = task_run
            .artifacts
            .as_ref()
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut resolved = artifacts_by_id(&manifest, &artifact_ids, false);
        if !artifact_ids.is_empty() && resolved.len() < artifact_ids.len() {
            if let (Some(task_id), Some(run_id)) = (&task_run.task, &task_run.id) {
                if let Ok(refreshed) = self.api.get_task_run(task_id, run_id).await {
                    if let Some(refreshed_manifest) =
                        refreshed.artifacts.as_ref().and_then(Value::as_array)
                    {
                        manifest = refreshed_manifest.clone();
                        resolved = artifacts_by_id(&manifest, &artifact_ids, true);
                    }
                }
            }
        }

        let content_blocks = message
            .as_deref()
            .map(normalize_cloud_prompt_content)
            .unwrap_or_default();
        let task_id = task_run
            .task
            .clone()
            .unwrap_or_else(|| self.config.task_id.clone());
        let run_id = task_run
            .id
            .clone()
            .unwrap_or_else(|| self.config.run_id.clone());
        let mut built = self
            .artifact_manager
            .build_prompt(
                &self.api,
                &self.workspace_root(),
                &task_id,
                &run_id,
                content_blocks,
                &resolved,
            )
            .await;

        // Ids the manifest can't account for are attachments, not skills —
        // surface the missing-attachment notice instead of silently misleading.
        let expected_attachments = artifact_ids
            .iter()
            .filter(|artifact_id| {
                let known = manifest.iter().find(|artifact| {
                    artifact.get("id").and_then(Value::as_str) == Some(artifact_id.as_str())
                });
                match known {
                    Some(artifact) => {
                        artifact.get("type").and_then(Value::as_str) != Some("skill_bundle")
                    }
                    None => true,
                }
            })
            .count();
        let hydrated = built
            .prompt
            .iter()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("resource_link"))
            .count();
        if expected_attachments > hydrated {
            let lost = expected_attachments - hydrated;
            tracing::warn!(lost, "Pending user attachments could not be loaded");
            built
                .prompt
                .push(json!({ "type": "text", "text": missing_attachment_notice(lost) }));
        }

        (!built.prompt.is_empty()).then_some(built)
    }

    /// `clearPendingInitialPromptState`.
    async fn clear_pending_initial_prompt_state(
        &self,
        payload: &JwtPayload,
        task_run: Option<&TaskRun>,
    ) {
        let Some(state) = task_run.and_then(|run| run.state.as_ref()) else {
            return;
        };
        let keys: Vec<&str> = [
            "pending_user_message",
            "pending_user_artifact_ids",
            "pending_user_message_ts",
        ]
        .into_iter()
        .filter(|key| state.get(key).is_some())
        .collect();
        if keys.is_empty() {
            return;
        }
        if let Err(err) = self
            .api
            .update_task_run(
                &payload.task_id,
                &payload.run_id,
                json!({ "state_remove_keys": keys }),
            )
            .await
        {
            tracing::debug!(error = %err, "Failed to clear pending prompt state");
        }
    }

    fn workspace_root(&self) -> String {
        self.config
            .repository_path
            .clone()
            .unwrap_or_else(|| "/tmp/workspace".to_string())
    }

    /// Shared end-of-turn bookkeeping: branch sync, turn_complete broadcast,
    /// Slack relay.
    async fn finish_turn(
        self: &Arc<Self>,
        session: &Arc<ActiveSession>,
        stop_reason: &str,
        relay: bool,
    ) {
        if stop_reason == "end_turn" {
            let server = Arc::clone(self);
            let session_clone = Arc::clone(session);
            tokio::spawn(async move {
                server.sync_cloud_branch_metadata(&session_clone).await;
            });
        }

        self.broadcast_turn_complete(session, stop_reason).await;

        if relay && stop_reason == "end_turn" {
            self.relay_agent_response(session).await;
        }
    }

    /// `broadcastTurnComplete` — skipped when the adapter already emitted one.
    async fn broadcast_turn_complete(&self, session: &ActiveSession, stop_reason: &str) {
        if session
            .shared
            .adapter_emitted_turn_complete
            .swap(false, Ordering::SeqCst)
        {
            return;
        }
        let notification = json!({
            "jsonrpc": "2.0",
            "method": ext::TURN_COMPLETE,
            "params": { "sessionId": session.acp_session_id, "stopReason": stop_reason },
        });
        self.broadcast_and_log(session, &notification).await;
    }

    fn broadcast_turn_failure(
        &self,
        session: &ActiveSession,
        classification: AgentErrorClassification,
        message: &str,
    ) {
        let notification = json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": session.acp_session_id,
                "update": {
                    "sessionUpdate": "error",
                    "errorType": classification.as_str(),
                    "message": message,
                },
            },
        });
        self.bus
            .broadcast(notification_envelope(&notification.to_string()));
        let writer = session.shared.log_writer.clone();
        tokio::spawn(async move { writer.append_notification(&notification).await });
    }

    /// `handleTurnFailure`. Returns whether the turn error is recoverable
    /// (interactive follow-ups on transient upstream failures).
    async fn handle_turn_failure(
        self: &Arc<Self>,
        session: &Arc<ActiveSession>,
        phase: TurnPhase,
        message: &str,
        error_data: Option<&Value>,
    ) -> bool {
        // Prefer the structured classification carried on the RPC error data.
        let classification = error_data
            .and_then(|data| data.get("classification"))
            .and_then(Value::as_str)
            .and_then(parse_classification)
            .unwrap_or_else(|| classify_agent_error(Some(message)));

        let is_upstream = classification.is_upstream_failure();
        let display_message = if is_upstream {
            UPSTREAM_PROVIDER_FAILURE_MESSAGE.to_string()
        } else if message.is_empty() {
            "Agent error".to_string()
        } else {
            message.to_string()
        };
        let recoverable = is_upstream
            && phase == TurnPhase::Followup
            && self.effective_mode(&session.payload) == AgentMode::Interactive;

        tracing::error!(
            classification = classification.as_str(),
            message,
            recoverable,
            "send_{}_task_message_failed",
            phase.as_str()
        );

        self.broadcast_turn_failure(session, classification, &display_message);

        if recoverable {
            self.broadcast_turn_complete(session, "error_recoverable")
                .await;
            return true;
        }

        self.signal_task_complete(session, "error", Some(&display_message))
            .await;
        false
    }

    fn effective_mode(&self, payload: &JwtPayload) -> AgentMode {
        match payload.mode.as_str() {
            "background" => AgentMode::Background,
            "interactive" => AgentMode::Interactive,
            _ => self.config.mode,
        }
    }

    /// `signalTaskComplete`: only error stop reasons update the run status.
    async fn signal_task_complete(
        &self,
        session: &ActiveSession,
        stop_reason: &str,
        error_message: Option<&str>,
    ) {
        session.shared.log_writer.flush().await;

        if stop_reason != "error" {
            tracing::debug!(
                stop_reason,
                "Skipping status update for non-error stop reason"
            );
            return;
        }

        let error_message = error_message.unwrap_or("Agent error");
        let terminal = json!({
            "jsonrpc": "2.0",
            "method": ext::ERROR,
            "params": {
                "source": "agent_server",
                "stopReason": stop_reason,
                "error": error_message,
            },
        });
        self.bus
            .enqueue_ingest_only(notification_envelope(&terminal.to_string()));

        let result = self
            .api
            .update_task_run(
                &session.payload.task_id,
                &session.payload.run_id,
                json!({ "status": "failed", "error_message": error_message }),
            )
            .await;
        match result {
            Ok(()) => tracing::debug!(stop_reason, "Task completion signaled"),
            Err(err) => tracing::error!(error = %err, "Failed to signal task completion"),
        }
        self.bus.stop_ingest().await;
    }

    /// `syncCloudBranchMetadata`: attach the current git branch to the run.
    async fn sync_cloud_branch_metadata(&self, session: &ActiveSession) {
        let Some(repo) = &self.config.repository_path else {
            return;
        };
        let branch = current_git_branch(repo).await;
        let Some(branch) = branch else {
            return;
        };
        {
            let last = self.last_reported_branch.lock().expect("branch lock");
            if last.as_deref() == Some(branch.as_str()) {
                return;
            }
        }

        let result = self
            .api
            .update_task_run(
                &session.payload.task_id,
                &session.payload.run_id,
                json!({ "branch": branch, "output": { "head_branch": branch } }),
            )
            .await;
        match result {
            Ok(()) => {
                *self.last_reported_branch.lock().expect("branch lock") = Some(branch);
            }
            Err(err) => {
                tracing::debug!(error = %err, "Failed to attach current branch to task run");
            }
        }
    }

    /// `relayAgentResponse`: post the turn's assistant text to Slack.
    async fn relay_agent_response(&self, session: &ActiveSession) {
        if session
            .shared
            .question_relayed_to_slack
            .swap(false, Ordering::SeqCst)
        {
            return;
        }

        session.shared.log_writer.flush().await;
        let Some(message) = session.shared.log_writer.full_agent_response().await else {
            tracing::debug!("No agent message found for Slack relay");
            return;
        };
        let parts = session.shared.log_writer.agent_response_parts().await;

        if let Err(err) = self
            .api
            .relay_message(
                &session.payload.task_id,
                &session.payload.run_id,
                &message,
                &parts,
            )
            .await
        {
            tracing::debug!(error = %err, "Failed to relay agent response");
        }
    }

    /// `executeCommand` — the `POST /command` dispatch.
    pub async fn execute_command(
        self: &Arc<Self>,
        command: crate::command::CommandMethod,
        params: Value,
    ) -> Result<Value, String> {
        use crate::command::CommandMethod;

        let session = self.session().await.ok_or("No active session")?;

        match command {
            CommandMethod::UserMessage => self.execute_user_message(&session, params).await,
            CommandMethod::Cancel => {
                tracing::debug!(acp_session_id = %session.acp_session_id, "Cancel requested");
                session.peer.notify(
                    methods::SESSION_CANCEL,
                    json!({ "sessionId": session.acp_session_id }),
                );
                Ok(json!({ "cancelled": true }))
            }
            CommandMethod::Close => {
                tracing::debug!("Close requested");
                if let Some(local_git_state) = params.get("localGitState") {
                    *session
                        .shared
                        .pending_handoff_git_state
                        .lock()
                        .expect("handoff lock") = Some(local_git_state.clone());
                }
                self.cleanup_session(false).await;
                Ok(json!({ "closed": true }))
            }
            CommandMethod::SetConfigOption => {
                let config_id = params
                    .get("configId")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let value = params
                    .get("value")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                tracing::debug!(config_id, value, "Set config option requested");
                let result = session
                    .peer
                    .request(
                        methods::SESSION_SET_CONFIG_OPTION,
                        json!({
                            "sessionId": session.acp_session_id,
                            "configId": config_id,
                            "value": value,
                        }),
                    )
                    .await
                    .map_err(|err| err.message.clone())?;
                Ok(json!({ "configOptions": result.get("configOptions") }))
            }
            CommandMethod::RefreshSession => {
                let mcp_servers = params
                    .get("mcpServers")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let refreshed_credentials: Vec<&str> = params
                    .get("refreshedCredentials")
                    .and_then(Value::as_array)
                    .map(|list| list.iter().filter_map(Value::as_str).collect())
                    .unwrap_or_default();
                if !refreshed_credentials.is_empty() {
                    tracing::debug!(
                        credentials = refreshed_credentials.join(", "),
                        "Refreshed sandbox credentials"
                    );
                }
                if mcp_servers.is_empty() {
                    return Ok(json!({ "refreshed": true }));
                }
                tracing::debug!(
                    server_count = mcp_servers.len(),
                    "Refresh session requested"
                );
                session
                    .peer
                    .request(ext::REFRESH_SESSION, json!({ "mcpServers": mcp_servers }))
                    .await
                    .map_err(|err| err.message.clone())
            }
            CommandMethod::PermissionResponse => {
                let request_id = params
                    .get("requestId")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let option_id = params
                    .get("optionId")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                tracing::debug!(request_id, option_id, "Permission response received");
                let resolved = session.shared.resolve_permission(
                    request_id,
                    option_id,
                    params
                        .get("customInput")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    params.get("answers").cloned(),
                );
                if !resolved {
                    return Err(format!(
                        "No pending permission request found for id: {request_id}"
                    ));
                }
                Ok(json!({ "resolved": true }))
            }
        }
    }

    async fn execute_user_message(
        self: &Arc<Self>,
        session: &Arc<ActiveSession>,
        params: Value,
    ) -> Result<Value, String> {
        let content_blocks: Vec<Value> = match params.get("content") {
            Some(Value::String(text)) if !text.trim().is_empty() => {
                normalize_cloud_prompt_content(text)
            }
            Some(Value::Array(blocks)) => blocks.clone(),
            _ => Vec::new(),
        };
        let artifacts: Vec<Value> = params
            .get("artifacts")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        let built = self
            .artifact_manager
            .build_prompt(
                &self.api,
                &self.workspace_root(),
                &session.payload.task_id,
                &session.payload.run_id,
                content_blocks,
                &artifacts,
            )
            .await;
        let mut prompt = built.prompt;

        // Attachments that failed to hydrate must not point the agent at
        // files it was never given.
        let expected_attachments = artifacts
            .iter()
            .filter(|a| a.get("type").and_then(Value::as_str) != Some("skill_bundle"))
            .count();
        let hydrated = prompt
            .iter()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("resource_link"))
            .count();
        if expected_attachments > hydrated {
            prompt.push(json!({
                "type": "text",
                "text": missing_attachment_notice(expected_attachments - hydrated),
            }));
        }
        if prompt.is_empty() {
            return Err("User message cannot be empty".to_string());
        }

        // Duplicate delivery guard, capped at the 500 most recent ids.
        let message_id = params
            .get("messageId")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .map(str::to_string);
        if let Some(message_id) = &message_id {
            let mut delivered = self.delivered_message_ids.lock().expect("delivered lock");
            let (order, set) = &mut *delivered;
            if set.contains(message_id) {
                tracing::info!(message_id, "Duplicate user_message delivery ignored");
                return Ok(json!({ "stopReason": "duplicate_delivery", "duplicate": true }));
            }
            set.insert(message_id.clone());
            order.push_back(message_id.clone());
            if order.len() > 500 {
                if let Some(oldest) = order.pop_front() {
                    set.remove(&oldest);
                }
            }
        }

        session.shared.log_writer.reset_turn_messages().await;

        // Resolve before the detected-PR context so a warm auto-publish
        // upgrade also flips it to its push variant.
        let auto_publish_upgrade = self.resolve_warm_auto_publish_upgrade(session).await;
        let effective_config = self.effective_prompt_config();
        let detected_pr = session
            .shared
            .detected_pr_url
            .lock()
            .expect("pr lock")
            .clone();
        let mut host_context: Vec<String> = Vec::new();
        if let Some(upgrade) = auto_publish_upgrade {
            host_context.push(upgrade);
        }
        if let Some(pr_url) = &detected_pr {
            host_context.push(detected_pr_context(&effective_config, pr_url));
        }

        let mut prompt_meta = built.meta.unwrap_or_else(|| json!({}));
        if !host_context.is_empty() {
            prompt_meta["prContext"] = json!(host_context.join("\n\n"));
        }
        let mut request = json!({
            "sessionId": session.acp_session_id,
            "prompt": prompt,
        });
        if prompt_meta
            .as_object()
            .map(|m| !m.is_empty())
            .unwrap_or(false)
        {
            request["_meta"] = prompt_meta;
        }

        let result = session.peer.request(methods::SESSION_PROMPT, request).await;

        let response = match result {
            Ok(response) => response,
            Err(err) => {
                if let Some(message_id) = &message_id {
                    let mut delivered = self.delivered_message_ids.lock().expect("delivered lock");
                    delivered.1.remove(message_id);
                }
                session.shared.log_writer.flush().await;
                let recoverable = self
                    .handle_turn_failure(
                        session,
                        TurnPhase::Followup,
                        &err.message,
                        err.data.as_ref(),
                    )
                    .await;
                if !recoverable {
                    return Err(err.message);
                }
                return Ok(json!({ "stopReason": "error_recoverable" }));
            }
        };

        let stop_reason = response
            .get("stopReason")
            .and_then(Value::as_str)
            .unwrap_or("end_turn")
            .to_string();
        tracing::debug!(stop_reason, "User message completed");

        self.finish_turn(session, &stop_reason, true).await;

        session.shared.log_writer.flush().await;
        let assistant_message = session.shared.log_writer.full_agent_response().await;

        let mut result = json!({ "stopReason": stop_reason });
        if let Some(assistant_message) = assistant_message {
            result["assistant_message"] = json!(assistant_message);
        }
        Ok(result)
    }

    /// `resolveWarmAutoPublishUpgrade`: prewarmed runs boot before the user's
    /// auto-publish choice exists; resolve it from run state on the first
    /// message and inject the publish instructions as a prompt override.
    async fn resolve_warm_auto_publish_upgrade(
        self: &Arc<Self>,
        session: &Arc<ActiveSession>,
    ) -> Option<String> {
        if !self.prewarmed_run.load(Ordering::SeqCst)
            || self.warm_auto_publish_resolved.load(Ordering::SeqCst)
        {
            return None;
        }
        let config = self.effective_prompt_config();
        if config.auto_publish == Some(true)
            || config.create_pr == Some(false)
            || crate::system_prompt::is_automated_origin(&config)
        {
            // The boot decision already publishes (or never may).
            self.warm_auto_publish_resolved
                .store(true, Ordering::SeqCst);
            return None;
        }
        let run = match self
            .api
            .get_task_run(&session.payload.task_id, &session.payload.run_id)
            .await
        {
            Ok(run) => run,
            Err(err) => {
                // Leave unresolved so the next message retries.
                tracing::debug!(error = %err, "Failed to fetch run state for auto-publish upgrade");
                return None;
            }
        };
        self.warm_auto_publish_resolved
            .store(true, Ordering::SeqCst);
        if run.state_bool("auto_publish") != Some(true) {
            return None;
        }
        *self.auto_publish_override.lock().expect("override lock") = Some(true);
        tracing::debug!("Warm run upgraded to auto-publish from run state");

        let upgraded_config = self.effective_prompt_config();
        let detected_pr = session
            .shared
            .detected_pr_url
            .lock()
            .expect("pr lock")
            .clone();
        let ctx = PromptContext {
            config: &upgraded_config,
            pr_url: detected_pr.as_deref(),
            slack_thread_url: None,
            inbox_report_url: None,
        };
        Some(
            [
                "IMPORTANT — OVERRIDE PREVIOUS INSTRUCTIONS ABOUT CREATING BRANCHES/PRs.",
                "The user has auto-publish enabled for this run. The review-first cloud task instructions in your system prompt are replaced by the following:",
                "",
                &crate::system_prompt::build_cloud_system_prompt(&ctx),
            ]
            .join("\n"),
        )
    }

    /// Config with the warm auto-publish override applied — prompt builders
    /// must see the resolved value.
    fn effective_prompt_config(&self) -> ServerConfig {
        let mut config = self.config.clone();
        if let Some(auto_publish) = *self.auto_publish_override.lock().expect("override lock") {
            config.auto_publish = Some(auto_publish);
        }
        config
    }

    /// `captureCheckpointState`: capture + upload a handoff checkpoint and
    /// broadcast it as `_posthog/git_checkpoint`.
    async fn capture_checkpoint_state(
        &self,
        session: &ActiveSession,
        local_git_state: Option<LocalGitState>,
    ) {
        let Some(repo) = &self.config.repository_path else {
            return;
        };
        let tracker = HandoffTracker {
            repository_path: repo,
            task_id: &session.payload.task_id,
            run_id: &session.payload.run_id,
            api: &self.api,
        };
        let checkpoint = match tracker.capture_for_handoff(local_git_state.as_ref()).await {
            Ok(checkpoint) => checkpoint,
            Err(err) => {
                tracing::warn!(error = %err, "Failed to capture handoff checkpoint");
                return;
            }
        };

        let device = json!({
            "type": "cloud",
            "name": self.config.hostname.as_deref().unwrap_or("cloud-sandbox"),
        });
        let notification = json!({
            "jsonrpc": "2.0",
            "method": ext::GIT_CHECKPOINT,
            "params": checkpoint.to_event_params(&device),
        });
        self.broadcast_and_log(session, &notification).await;
    }

    /// Checkpoint worker: coalesces capture requests from file-mutating tool
    /// calls so a burst of edits produces one capture.
    fn spawn_checkpoint_worker(
        self: &Arc<Self>,
        session: Arc<ActiveSession>,
        mut requests: tokio::sync::mpsc::UnboundedReceiver<()>,
    ) {
        let server = Arc::clone(self);
        tokio::spawn(async move {
            while requests.recv().await.is_some() {
                while requests.try_recv().is_ok() {}
                server.capture_checkpoint_state(&session, None).await;
            }
        });
    }

    /// `cleanupSession`.
    pub async fn cleanup_session(&self, complete_event_stream: bool) {
        let session = {
            let mut slot = self.session.lock().await;
            slot.take()
        };
        let Some(session) = session else {
            if complete_event_stream {
                self.bus.stop_ingest().await;
            }
            return;
        };

        tracing::debug!("Cleaning up session");
        self.session_active.store(false, Ordering::SeqCst);

        let local_git_state = session
            .shared
            .pending_handoff_git_state
            .lock()
            .expect("handoff lock")
            .take()
            .map(|value| LocalGitState::from_value(&value));
        self.capture_checkpoint_state(&session, local_git_state)
            .await;

        session.shared.log_writer.flush().await;

        // Drain pending permissions before ACP teardown to avoid deadlocks —
        // teardown may await operations blocked on a permission response.
        session.shared.drain_pending_permissions();

        // Close the child's stdin so it can exit on EOF; grace, then kill.
        session.peer.close();
        let child = session.child.lock().expect("child lock").take();
        if let Some(mut child) = child {
            let graceful = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
            if graceful.is_err() {
                let _ = child.kill().await;
            }
        }

        if complete_event_stream {
            self.bus.stop_ingest().await;
        }
    }

    /// `reportFatalError`: mark the run failed after an unrecoverable crash so
    /// a hard death surfaces a real error instead of a silent stall.
    pub async fn report_fatal_error(&self, error_message: &str) {
        tracing::error!(
            error_message,
            "Fatal agent-server error; marking run failed"
        );

        let update = self.api.update_task_run(
            &self.config.task_id,
            &self.config.run_id,
            json!({
                "status": "failed",
                "error_message": format!("Agent server crashed: {error_message}"),
            }),
        );
        if let Err(err) = update.await {
            tracing::error!(error = %err, "Failed to mark run failed after fatal error");
        }

        self.bus.stop_ingest().await;
    }

    /// `stop`.
    pub async fn stop(&self) {
        tracing::debug!("Stopping agent server...");
        self.cleanup_session(true).await;
        tracing::debug!("Agent server stopped");
    }
}

/// `deserializeCloudPrompt`: strings normally become one text block; the
/// `__twig_cloud_prompt_v1__:` prefix carries serialized ContentBlock arrays.
fn normalize_cloud_prompt_content(content: &str) -> Vec<Value> {
    const CLOUD_PROMPT_PREFIX: &str = "__twig_cloud_prompt_v1__:";
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if let Some(payload) = trimmed.strip_prefix(CLOUD_PROMPT_PREFIX) {
        if let Ok(parsed) = serde_json::from_str::<Value>(payload) {
            if let Some(blocks) = parsed.get("blocks").and_then(Value::as_array) {
                if !blocks.is_empty() {
                    return blocks.clone();
                }
            }
        }
    }
    vec![json!({ "type": "text", "text": trimmed })]
}

fn parse_classification(raw: &str) -> Option<AgentErrorClassification> {
    match raw {
        "upstream_stream_terminated" => Some(AgentErrorClassification::UpstreamStreamTerminated),
        "upstream_connection_error" => Some(AgentErrorClassification::UpstreamConnectionError),
        "upstream_timeout" => Some(AgentErrorClassification::UpstreamTimeout),
        "upstream_provider_failure" => Some(AgentErrorClassification::UpstreamProviderFailure),
        "agent_error" => Some(AgentErrorClassification::AgentError),
        _ => None,
    }
}

async fn current_git_branch(repo: &str) -> Option<String> {
    let output = tokio::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(repo)
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() || branch == "HEAD" {
        None
    } else {
        Some(branch)
    }
}
