//! ACP client-side handler: the agent's inbound requests and notifications.
//!
//! Port of `createCloudClient` in `agent-server.ts` — permission approval
//! policy (auto-approve, question parking, Slack relay, client relay with
//! pending-permission bookkeeping), permission-mode tracking, and created-PR
//! attribution from session updates.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use posthog_acp::{client_methods, ext, IncomingHandler, RpcError};
use serde_json::{json, Value};
use tokio::sync::oneshot;

use crate::bus::{value_envelope, EventBus};
use crate::config::{AgentMode, ServerConfig};
use crate::log_writer::SessionLogWriter;
use crate::posthog_api::PostHogApiClient;

/// Resolution delivered back to a relayed `session/request_permission`.
#[derive(Debug, Clone)]
pub struct PermissionResolution {
    pub option_id: String,
    pub custom_input: Option<String>,
    pub answers: Option<Value>,
}

pub struct PendingPermission {
    pub tool_call_id: Option<String>,
    pub resolve: oneshot::Sender<PermissionResolution>,
}

/// State shared between the HTTP layer, the session orchestrator, and this
/// handler (the subset of `AgentServer`'s mutable fields the agent's inbound
/// traffic can touch).
pub struct SessionShared {
    pub config: ServerConfig,
    pub api: Arc<PostHogApiClient>,
    pub bus: EventBus,
    pub log_writer: SessionLogWriter,
    /// Current ACP permission mode, tracked for relay decisions.
    pub permission_mode: Mutex<String>,
    /// Whether a desktop client has ever connected via SSE during this session.
    pub has_desktop_connected: AtomicBool,
    pub adapter_emitted_turn_complete: AtomicBool,
    pub question_relayed_to_slack: AtomicBool,
    pub pending_permissions: Mutex<HashMap<String, PendingPermission>>,
    pub detected_pr_url: Mutex<Option<String>>,
    pub evaluated_pr_urls: Mutex<HashSet<String>>,
}

impl SessionShared {
    pub fn resolve_permission(
        &self,
        request_id: &str,
        option_id: &str,
        custom_input: Option<String>,
        answers: Option<Value>,
    ) -> bool {
        let pending = {
            let mut map = self.pending_permissions.lock().expect("permissions lock");
            map.remove(request_id)
        };
        let Some(pending) = pending else {
            return false;
        };

        self.persist_permission_lifecycle(
            ext::PERMISSION_RESOLVED,
            json!({
                "requestId": request_id,
                "toolCallId": pending.tool_call_id,
                "optionId": option_id,
            }),
        );

        let _ = pending.resolve.send(PermissionResolution {
            option_id: option_id.to_string(),
            custom_input,
            answers,
        });
        true
    }

    /// Force-resolve all pending permissions (session shutdown) so cleanup
    /// can't deadlock on an operation waiting for an answer.
    pub fn drain_pending_permissions(&self) {
        let drained: Vec<PendingPermission> = {
            let mut map = self.pending_permissions.lock().expect("permissions lock");
            map.drain().map(|(_, pending)| pending).collect()
        };
        for pending in drained {
            let _ = pending.resolve.send(PermissionResolution {
                option_id: "reject".to_string(),
                custom_input: Some("Session is shutting down.".to_string()),
                answers: None,
            });
        }
    }

    fn persist_permission_lifecycle(&self, method: &str, params: Value) {
        let notification = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        let writer = self.log_writer.clone();
        tokio::spawn(async move { writer.append_notification(&notification).await });
    }

    pub fn effective_mode(&self) -> AgentMode {
        self.config.mode
    }

    fn session_permission_mode(&self) -> String {
        self.permission_mode.lock().expect("mode lock").clone()
    }

    /// "plan" relays like "read-only" (look-don't-touch): escalations need a
    /// human veto, not silent auto-approval.
    fn should_relay_permission_to_client(mode: &str) -> bool {
        matches!(mode, "default" | "auto" | "read-only" | "plan")
    }
}

pub struct ClientHandler {
    pub shared: Arc<SessionShared>,
}

#[async_trait::async_trait]
impl IncomingHandler for ClientHandler {
    async fn handle_request(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        match method {
            client_methods::SESSION_REQUEST_PERMISSION => {
                Ok(self.handle_permission_request(params).await)
            }
            // clientCapabilities are empty — a well-behaved agent never asks.
            client_methods::FS_READ_TEXT_FILE | client_methods::FS_WRITE_TEXT_FILE => {
                Err(RpcError::method_not_found(method))
            }
            _ => Err(RpcError::method_not_found(method)),
        }
    }

    async fn handle_notification(&self, method: &str, params: Value) {
        match method {
            client_methods::SESSION_UPDATE => self.handle_session_update(params).await,
            ext::STRUCTURED_OUTPUT => self.handle_structured_output(params).await,
            _ => {
                tracing::debug!(method, "Extension notification");
            }
        }
    }
}

impl ClientHandler {
    async fn handle_session_update(&self, params: Value) {
        let update = params.get("update");

        // Track permission mode changes for relay decisions.
        if update
            .and_then(|u| u.get("sessionUpdate"))
            .and_then(Value::as_str)
            == Some("current_mode_update")
        {
            if let Some(mode) = update
                .and_then(|u| u.get("currentModeId"))
                .and_then(Value::as_str)
            {
                *self.shared.permission_mode.lock().expect("mode lock") = mode.to_string();
                tracing::debug!(mode, "Permission mode updated");
            }
        }

        if let Some(update) = update {
            self.maybe_attach_created_pr(update);
        }

        // Capture checkpoints for file-changing tools so cloud resumes restore
        // from git checkpoints rather than tree snapshots.
        // TODO(phase-1.5): port HandoffCheckpointTracker (git pack capture +
        // artifact upload). Until then only the trigger wiring exists.
        if update
            .and_then(|u| u.get("sessionUpdate"))
            .and_then(Value::as_str)
            == Some("tool_call_update")
        {
            let meta = update.and_then(|u| u.pointer("/_meta/claudeCode"));
            let tool_name = meta
                .and_then(|m| m.get("toolName"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            let has_file_path = meta
                .and_then(|m| m.pointer("/toolResponse/filePath"))
                .is_some();
            if has_file_path
                && matches!(
                    tool_name,
                    "Write" | "Edit" | "MultiEdit" | "Delete" | "Move"
                )
            {
                tracing::debug!(
                    tool_name,
                    "File-mutating tool completed (checkpoint capture pending port)"
                );
            }
        }
    }

    async fn handle_structured_output(&self, params: Value) {
        let Some(output) = params.get("output").cloned() else {
            return;
        };
        let shared = Arc::clone(&self.shared);
        let result = shared
            .api
            .set_task_run_output(
                &shared.config.task_id,
                &shared.config.run_id,
                json!({ "output": output }),
            )
            .await;
        if let Err(err) = result {
            tracing::warn!(error = %err, "Failed to persist structured output");
        }
    }

    /// `maybeAttachCreatedPr`: attribute PRs the agent created this run.
    fn maybe_attach_created_pr(&self, update: &Value) {
        let serialized = update.to_string();
        let Some(pr_url) = find_pr_url(&serialized) else {
            return;
        };
        {
            let mut evaluated = self.shared.evaluated_pr_urls.lock().expect("pr lock");
            if !evaluated.insert(pr_url.clone()) {
                return;
            }
        }
        let shared = Arc::clone(&self.shared);
        tokio::spawn(async move {
            attach_pr_if_created_this_run(&shared, &pr_url).await;
        });
    }

    async fn handle_permission_request(&self, params: Value) -> Value {
        let shared = &self.shared;
        let mode = shared.effective_mode();
        let interaction_origin = shared.config.interaction_origin.as_deref();

        let options = params
            .get("options")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let tool_call = params.get("toolCall").cloned();

        tracing::debug!(
            mode = mode.as_str(),
            ?interaction_origin,
            "Permission request"
        );

        let allow_option_id = options
            .iter()
            .find(|o| {
                matches!(
                    o.get("kind").and_then(Value::as_str),
                    Some("allow_once") | Some("allow_always")
                )
            })
            .or_else(|| options.first())
            .and_then(|o| o.get("optionId"))
            .and_then(Value::as_str)
            .unwrap_or("allow")
            .to_string();

        let code_tool_kind = tool_call
            .as_ref()
            .and_then(|tc| tc.pointer("/_meta/codeToolKind"))
            .and_then(Value::as_str);
        let is_question = code_tool_kind == Some("question");
        let is_plan_approval = tool_call
            .as_ref()
            .and_then(|tc| tc.get("kind"))
            .and_then(Value::as_str)
            == Some("switch_mode");

        // Relay questions to Slack when interaction originated there.
        if interaction_origin == Some("slack") && is_question {
            self.relay_slack_question(tool_call.as_ref().and_then(|tc| tc.get("_meta")));
            return json!({
                "outcome": { "outcome": "cancelled" },
                "_meta": {
                    "message": "This question has been relayed to the Slack thread where this task originated. The user will reply there. Do NOT re-ask the question or pick an answer yourself. Simply let the user know you are waiting for your reply.",
                },
            });
        }

        let session_permission_mode = shared.session_permission_mode();
        let needs_desktop_approval =
            SessionShared::should_relay_permission_to_client(&session_permission_mode);
        let has_desktop_connected = shared.has_desktop_connected.load(Ordering::SeqCst);
        // With durable event ingest nothing connects to GET /events; an
        // active event stream counts as a reachable client for questions.
        let has_reachable_client =
            has_desktop_connected || shared.config.event_ingest_token.is_some();

        if mode != AgentMode::Background
            && (is_plan_approval
                || (is_question && has_reachable_client)
                || (needs_desktop_approval && has_desktop_connected))
        {
            tracing::debug!(
                is_question,
                has_desktop_connected,
                "Relaying permission request"
            );
            return self
                .relay_permission_to_client(&options, tool_call.as_ref())
                .await;
        }

        // A question that cannot be relayed must never fall through to
        // auto-approve: park it for the user instead.
        if is_question {
            return json!({
                "outcome": { "outcome": "cancelled" },
                "_meta": {
                    "message": "No user is available to answer this question right now. Do NOT pick an answer yourself and do NOT re-ask via this tool. Restate the question and its options in your response, then end your turn so the user can answer when they are back.",
                },
            });
        }

        if self.should_block_publish_permission(tool_call.as_ref()) {
            return json!({
                "outcome": { "outcome": "cancelled" },
                "_meta": {
                    "message": "This run is configured to stop before publishing. Do not push commits or create/update pull requests unless the user explicitly asks.",
                },
            });
        }

        json!({ "outcome": { "outcome": "selected", "optionId": allow_option_id } })
    }

    /// `shouldBlockPublishPermission`: createPr=false runs cancel raw
    /// git-push / gh-pr Bash invocations.
    fn should_block_publish_permission(&self, tool_call: Option<&Value>) -> bool {
        if self.shared.config.create_pr != Some(false) {
            return false;
        }
        let Some(tool_call) = tool_call else {
            return false;
        };
        let tool_name = tool_call
            .pointer("/_meta/toolName")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let command = tool_call
            .pointer("/rawInput/command")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if command.is_empty() || !(tool_name == "Bash" || tool_name.contains("bash")) {
            return false;
        }
        publish_command_regex().is_match(command)
    }

    /// `relayPermissionToClient`: broadcast a `permission_request` frame, log
    /// the lifecycle, and wait (indefinitely) for `permission_response`.
    async fn relay_permission_to_client(
        &self,
        options: &[Value],
        tool_call: Option<&Value>,
    ) -> Value {
        let shared = &self.shared;
        let request_id = uuid::Uuid::new_v4().to_string();
        let tool_call_id = tool_call
            .and_then(|tc| tc.get("toolCallId"))
            .and_then(Value::as_str)
            .map(str::to_string);

        shared.bus.broadcast(value_envelope(&json!({
            "type": "permission_request",
            "requestId": request_id,
            "options": options,
            "toolCall": tool_call,
        })));

        // Persist the request so a client that connects after the live event
        // can recover the requestId from the log.
        shared.persist_permission_lifecycle(
            ext::PERMISSION_REQUEST,
            json!({
                "requestId": request_id,
                "toolCallId": tool_call_id,
                "options": options,
                "toolCall": tool_call,
            }),
        );

        let (tx, rx) = oneshot::channel();
        shared
            .pending_permissions
            .lock()
            .expect("permissions lock")
            .insert(
                request_id.clone(),
                PendingPermission {
                    tool_call_id,
                    resolve: tx,
                },
            );

        match rx.await {
            Ok(resolution) => {
                let mut meta = serde_json::Map::new();
                if let Some(custom_input) = resolution.custom_input {
                    meta.insert("customInput".to_string(), json!(custom_input));
                }
                if let Some(answers) = resolution.answers {
                    meta.insert("answers".to_string(), answers);
                }
                let mut response = json!({
                    "outcome": { "outcome": "selected", "optionId": resolution.option_id },
                });
                if !meta.is_empty() {
                    response["_meta"] = Value::Object(meta);
                }
                response
            }
            // Sender dropped without resolution (session teardown race).
            Err(_) => json!({
                "outcome": { "outcome": "selected", "optionId": "reject" },
                "_meta": { "customInput": "Session is shutting down." },
            }),
        }
    }

    /// `relaySlackQuestion`: format the first question and post it to the
    /// originating Slack thread via the relay endpoint.
    fn relay_slack_question(&self, tool_meta: Option<&Value>) {
        let Some(question) = tool_meta
            .and_then(|m| m.get("questions"))
            .and_then(Value::as_array)
            .and_then(|qs| qs.first())
        else {
            return;
        };
        let Some(question_text) = question.get("question").and_then(Value::as_str) else {
            return;
        };

        let mut message = format!("*{question_text}*\n\n");
        if let Some(options) = question.get("options").and_then(Value::as_array) {
            for (i, option) in options.iter().enumerate() {
                let Some(label) = option.get("label").and_then(Value::as_str) else {
                    continue;
                };
                message.push_str(&format!("{}. *{label}*", i + 1));
                if let Some(description) = option.get("description").and_then(Value::as_str) {
                    message.push_str(&format!(" — {description}"));
                }
                message.push('\n');
            }
        }
        message.push_str("\nReply in this thread with your choice.");

        self.shared
            .question_relayed_to_slack
            .store(true, Ordering::SeqCst);
        let shared = Arc::clone(&self.shared);
        tokio::spawn(async move {
            if let Err(err) = shared
                .api
                .relay_message(&shared.config.task_id, &shared.config.run_id, &message, &[])
                .await
            {
                tracing::debug!(error = %err, "Failed to relay question to Slack");
            }
        });
    }
}

fn publish_command_regex() -> &'static regex::Regex {
    static REGEX: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    REGEX.get_or_init(|| {
        regex::Regex::new(r"\bgit\s+push\b|\bgh\s+pr\s+(create|edit|ready|merge)\b")
            .expect("valid publish regex")
    })
}

/// `findPrUrl` from `pr-url-detector.ts`.
pub fn find_pr_url(text: &str) -> Option<String> {
    static REGEX: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let regex = REGEX.get_or_init(|| {
        regex::Regex::new(r#"https://github\.com/[^/\s"]+/[^/\s"]+/pull/\d+"#)
            .expect("valid PR regex")
    });
    regex.find(text).map(|m| m.as_str().to_string())
}

/// A fixed window (not "since run start") so a PR the agent merely views on a
/// long run is too old to be mistaken for one it just created.
pub const PR_CREATION_RECENCY_MS: i64 = 5 * 60 * 1000;

pub fn was_created_recently(created_at_iso: Option<&str>, now_ms: i64) -> bool {
    let Some(created_at_iso) = created_at_iso else {
        return false;
    };
    let Ok(created_at) = chrono::DateTime::parse_from_rfc3339(created_at_iso) else {
        return false;
    };
    created_at.timestamp_millis() >= now_ms - PR_CREATION_RECENCY_MS
}

async fn attach_pr_if_created_this_run(shared: &Arc<SessionShared>, pr_url: &str) {
    // Already the attributed PR (e.g. seeded from a Slack notification).
    if shared.detected_pr_url.lock().expect("pr lock").as_deref() == Some(pr_url) {
        return;
    }

    let created_at = fetch_pr_created_at(shared, pr_url).await;
    let now_ms = chrono::Utc::now().timestamp_millis();
    if !was_created_recently(created_at.as_deref(), now_ms) {
        return;
    }

    *shared.detected_pr_url.lock().expect("pr lock") = Some(pr_url.to_string());

    let result = shared
        .api
        .update_task_run(
            &shared.config.task_id,
            &shared.config.run_id,
            json!({ "output": { "pr_url": pr_url } }),
        )
        .await;
    match result {
        Ok(()) => tracing::debug!(pr_url, "Attributed created PR to task run"),
        Err(err) => tracing::error!(error = %err, pr_url, "Failed to attach PR URL to task run"),
    }
}

async fn fetch_pr_created_at(shared: &Arc<SessionShared>, pr_url: &str) -> Option<String> {
    let mut command = tokio::process::Command::new("gh");
    command.args(["pr", "view", pr_url, "--json", "createdAt"]);
    if let Some(repo) = &shared.config.repository_path {
        command.current_dir(repo);
    }
    let output = tokio::time::timeout(std::time::Duration::from_secs(10), command.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let parsed: Value = serde_json::from_slice(&output.stdout).ok()?;
    parsed
        .get("createdAt")
        .and_then(Value::as_str)
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_pr_urls() {
        assert_eq!(
            find_pr_url("see https://github.com/posthog/code/pull/123 for details"),
            Some("https://github.com/posthog/code/pull/123".to_string())
        );
        assert_eq!(find_pr_url("no urls here"), None);
    }

    #[test]
    fn pr_recency_window() {
        let now = chrono::Utc::now();
        let now_ms = now.timestamp_millis();
        let recent = (now - chrono::Duration::minutes(2)).to_rfc3339();
        let old = (now - chrono::Duration::minutes(10)).to_rfc3339();
        assert!(was_created_recently(Some(&recent), now_ms));
        assert!(!was_created_recently(Some(&old), now_ms));
        assert!(!was_created_recently(None, now_ms));
        assert!(!was_created_recently(Some("not-a-date"), now_ms));
    }

    #[test]
    fn publish_block_regex_matches_ts() {
        let regex = publish_command_regex();
        assert!(regex.is_match("git push origin main"));
        assert!(regex.is_match("gh pr create --draft"));
        assert!(regex.is_match("gh pr merge 1"));
        assert!(!regex.is_match("git commit -m x"));
        assert!(!regex.is_match("gh pr view 1"));
    }
}
