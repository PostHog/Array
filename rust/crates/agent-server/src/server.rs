//! The agent server: session lifecycle orchestration and command execution.
//!
//! Port of the `AgentServer` class in `agent-server.ts`. One active session
//! at a time; the agent runs as an ACP subprocess (see `adapter.rs`).
//!
//! Phase 1 gaps, tracked in `rust/README.md` (the Node sidecar keeps cloud
//! runs on the TS implementation for these until ported):
//! - session resume (`POSTHOG_RESUME_RUN_ID` / `resume_from_run_id` state)
//! - git handoff checkpoints (capture + apply)
//! - skill bundle installation and artifact attachment loading
//! - prewarmed-run auto-publish upgrade

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use posthog_acp::{ext, methods, Direction, LineTap, Peer, PeerHandle, PROTOCOL_VERSION};
use serde_json::{json, Value};
use tokio::process::Child;

use crate::adapter::{spawn_adapter, SidecarContext};
use crate::agent_version;
use crate::bus::{notification_envelope, EventBus, SseSink};
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
    /// Used once session resume lands (phase 1.5).
    #[allow(dead_code)]
    Resume,
    Followup,
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
        if self.config.resume_run_id.is_some() {
            // TODO(phase-1.5): port resumeFromLog + jsonl hydration. Runs
            // requesting resume must stay on the TS server until then.
            tracing::warn!(
                "POSTHOG_RESUME_RUN_ID set but session resume is not yet ported; starting fresh"
            );
        }

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

        // TODO(phase-1.5): install skill bundle artifacts before session/new.

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
            "permissionMode": initial_permission_mode,
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
        let acp_session_id = session_response
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("session/new returned no sessionId"))?
            .to_string();
        tracing::debug!(acp_session_id, run_id = %payload.run_id, "ACP session created");

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

    /// `sendInitialTaskMessage` (fresh-session path; resume is a phase-1.5 port).
    async fn send_initial_task_message(
        self: &Arc<Self>,
        session: &Arc<ActiveSession>,
        pre_task: Option<Task>,
        pre_task_run: Option<TaskRun>,
    ) {
        let payload = &session.payload;

        let task = match pre_task {
            Some(task) => Some(task),
            None => self.api.get_task(&payload.task_id).await.ok(),
        };

        // A prewarmed run gets its first message forwarded as a user_message
        // command on activation; building one from task.description here too
        // would deliver it twice.
        let prewarmed = pre_task_run
            .as_ref()
            .and_then(|run| run.state_bool("prewarmed"))
            .unwrap_or(false);

        let description = task.as_ref().and_then(|t| t.description.clone());
        let initial_prompt: Vec<Value> = match description {
            Some(description) if !description.is_empty() && !prewarmed => {
                vec![json!({ "type": "text", "text": description })]
            }
            _ => Vec::new(),
        };

        if initial_prompt.is_empty() {
            tracing::debug!(
                prewarmed,
                "No initial prompt to send (prewarmed run or empty task description)"
            );
            return;
        }

        session.shared.log_writer.reset_turn_messages().await;

        let result = session
            .peer
            .request(
                methods::SESSION_PROMPT,
                json!({ "sessionId": session.acp_session_id, "prompt": initial_prompt }),
            )
            .await;

        match result {
            Ok(response) => {
                let stop_reason = response
                    .get("stopReason")
                    .and_then(Value::as_str)
                    .unwrap_or("end_turn")
                    .to_string();
                tracing::debug!(stop_reason, "Initial task message completed");
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
                // TODO(phase-1.5): persist handoff localGitState from params
                // for the final checkpoint capture.
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
        // TODO(phase-1.5): artifact attachment loading (resource links).
        // Until then artifact-only messages surface the missing-attachment
        // notice rather than pointing the agent at files it was never given.
        let mut prompt: Vec<Value> = match params.get("content") {
            Some(Value::String(text)) if !text.trim().is_empty() => {
                vec![json!({ "type": "text", "text": text })]
            }
            Some(Value::Array(blocks)) => blocks.clone(),
            _ => Vec::new(),
        };
        let artifact_count = params
            .get("artifacts")
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0);
        if prompt.is_empty() && artifact_count > 0 {
            let subject = if artifact_count == 1 {
                "A file".to_string()
            } else {
                format!("{artifact_count} files")
            };
            let pronoun = if artifact_count == 1 { "it" } else { "they" };
            let noun = if artifact_count == 1 {
                "attachment"
            } else {
                "attachments"
            };
            prompt.push(json!({
                "type": "text",
                "text": format!(
                    "{subject} the user attached to this message could not be loaded into the session, so {pronoun} are unavailable here. Do not guess at the contents. Tell the user the {noun} didn't come through, and ask them to paste the text directly or send {pronoun} again."
                ),
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

        let detected_pr = session
            .shared
            .detected_pr_url
            .lock()
            .expect("pr lock")
            .clone();
        let mut request = json!({
            "sessionId": session.acp_session_id,
            "prompt": prompt,
        });
        if let Some(pr_url) = detected_pr {
            request["_meta"] = json!({ "prContext": detected_pr_context(&self.config, &pr_url) });
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

        // TODO(phase-1.5): capture the final handoff git checkpoint here.

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
