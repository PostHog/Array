//! End-to-end tests: a test harness plays the agent-server (ACP client over
//! an in-memory duplex), the driver under test spawns `mock-codex-app-server`
//! as the codex binary. Covers the handshake + thread setup, a streamed turn
//! with usage/turn_complete notifications, the approval relay, and
//! structured-output delivery.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use posthog_acp::{IncomingHandler, Peer, RpcError};
use posthog_codex_driver::driver::Driver;
use posthog_codex_driver::sidecar::SidecarConfig;
use serde_json::{json, Value};

type Recorded = Arc<Mutex<Vec<(String, Value)>>>;

struct TestClient {
    recorded: Recorded,
    permission_option: String,
}

#[async_trait::async_trait]
impl IncomingHandler for TestClient {
    async fn handle_request(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        if method == "session/request_permission" {
            self.recorded
                .lock()
                .expect("recorded lock")
                .push((method.to_string(), params));
            return Ok(json!({
                "outcome": { "outcome": "selected", "optionId": self.permission_option },
            }));
        }
        Err(RpcError::method_not_found(method))
    }

    async fn handle_notification(&self, method: &str, params: Value) {
        self.recorded
            .lock()
            .expect("recorded lock")
            .push((method.to_string(), params));
    }
}

fn spawn_driver(permission_option: &str) -> (Peer, Recorded) {
    // Same value in every test, so the set_var race between parallel tests is
    // benign.
    std::env::set_var(
        "POSTHOG_CODEX_BINARY_PATH",
        env!("CARGO_BIN_EXE_mock-codex-app-server"),
    );

    let (client_io, server_io) = tokio::io::duplex(1 << 20);
    let (client_read, client_write) = tokio::io::split(client_io);
    let (server_read, server_write) = tokio::io::split(server_io);

    let driver = Driver::new(SidecarConfig::default());
    tokio::spawn(async move {
        driver.run(server_read, server_write).await;
    });

    let recorded: Recorded = Arc::new(Mutex::new(Vec::new()));
    let handler = Arc::new(TestClient {
        recorded: Arc::clone(&recorded),
        permission_option: permission_option.to_string(),
    });
    let (peer, _handle) = Peer::spawn(client_read, client_write, handler, None);
    (peer, recorded)
}

async fn request(peer: &Peer, method: &str, params: Value) -> Value {
    tokio::time::timeout(Duration::from_secs(15), peer.request(method, params))
        .await
        .unwrap_or_else(|_| panic!("{method} timed out"))
        .unwrap_or_else(|err| panic!("{method} failed: {err}"))
}

async fn wait_for<F: Fn(&[(String, Value)]) -> bool>(
    recorded: &Recorded,
    predicate: F,
    what: &str,
) {
    for _ in 0..250 {
        if predicate(&recorded.lock().expect("recorded lock")) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let seen: Vec<String> = recorded
        .lock()
        .expect("recorded lock")
        .iter()
        .map(|(m, p)| {
            format!(
                "{m} {}",
                p.pointer("/update/sessionUpdate")
                    .and_then(Value::as_str)
                    .unwrap_or("")
            )
        })
        .collect();
    panic!("timed out waiting for {what}; saw: {seen:?}");
}

fn agent_chunks(recorded: &[(String, Value)], needle: &str) -> usize {
    recorded
        .iter()
        .filter(|(method, params)| {
            method == "session/update"
                && params
                    .pointer("/update/sessionUpdate")
                    .and_then(Value::as_str)
                    == Some("agent_message_chunk")
                && params
                    .pointer("/update/content/text")
                    .and_then(Value::as_str)
                    .map(|t| t.contains(needle))
                    .unwrap_or(false)
        })
        .count()
}

async fn new_session(peer: &Peer, extra_meta: Value) -> String {
    let init = request(
        peer,
        "initialize",
        json!({ "protocolVersion": 1, "clientCapabilities": {} }),
    )
    .await;
    assert_eq!(init["protocolVersion"], 1);
    assert_eq!(init["agentInfo"]["name"], "codex");

    let mut meta = json!({
        "environment": "cloud",
        "taskRunId": "run-1",
        "systemPrompt": { "append": "cloud test prompt" },
    });
    if let Some(extra) = extra_meta.as_object() {
        for (key, value) in extra {
            meta[key] = value.clone();
        }
    }
    let response = request(
        peer,
        "session/new",
        json!({ "cwd": "/tmp", "mcpServers": [], "_meta": meta }),
    )
    .await;
    response["sessionId"]
        .as_str()
        .expect("session/new returns sessionId")
        .to_string()
}

#[tokio::test]
async fn thread_setup_emits_config_commands_and_sdk_session() {
    let (peer, recorded) = spawn_driver("allow");
    let session_id = new_session(&peer, json!({})).await;
    assert_eq!(session_id, "mock-thread-1");

    wait_for(
        &recorded,
        |r| {
            r.iter().any(|(m, p)| {
                m == "session/update"
                    && p.pointer("/update/sessionUpdate").and_then(Value::as_str)
                        == Some("available_commands_update")
            }) && r.iter().any(|(m, _)| m == "_posthog/sdk_session")
        },
        "thread setup notifications",
    )
    .await;

    let snapshot = recorded.lock().expect("recorded lock").clone();
    let commands = snapshot
        .iter()
        .find_map(|(m, p)| {
            (m == "session/update"
                && p.pointer("/update/sessionUpdate").and_then(Value::as_str)
                    == Some("available_commands_update"))
            .then(|| p.pointer("/update/availableCommands").cloned())
            .flatten()
        })
        .expect("available commands update");
    // Disabled skills are dropped.
    let names: Vec<&str> = commands
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|c| c.get("name").and_then(Value::as_str))
        .collect();
    assert_eq!(names, vec!["review"]);

    let sdk_session = snapshot
        .iter()
        .find(|(m, _)| m == "_posthog/sdk_session")
        .map(|(_, p)| p.clone())
        .unwrap();
    assert_eq!(sdk_session["adapter"], "codex");
    assert_eq!(sdk_session["taskRunId"], "run-1");
    assert_eq!(sdk_session["sessionId"], "mock-thread-1");

    // The synthesized config options carry the model list from model/list.
    let config_options = snapshot
        .iter()
        .find_map(|(m, p)| {
            (m == "session/update"
                && p.pointer("/update/sessionUpdate").and_then(Value::as_str)
                    == Some("config_option_update"))
            .then(|| p.pointer("/update/configOptions").cloned())
            .flatten()
        })
        .expect("config option update");
    assert_eq!(config_options[1]["currentValue"], "gpt-5.5");
}

#[tokio::test]
async fn prompt_turn_streams_and_reports_usage() {
    let (peer, recorded) = spawn_driver("allow");
    let session_id = new_session(&peer, json!({})).await;

    let response = request(
        &peer,
        "session/prompt",
        json!({
            "sessionId": session_id,
            "prompt": [{ "type": "text", "text": "Say hello" }],
        }),
    )
    .await;
    assert_eq!(response["stopReason"], "end_turn");

    wait_for(
        &recorded,
        |r| r.iter().any(|(m, _)| m == "_posthog/turn_complete"),
        "turn complete notification",
    )
    .await;

    let snapshot = recorded.lock().expect("recorded lock").clone();
    // The consolidated agentMessage item is dropped after its delta streamed.
    assert_eq!(agent_chunks(&snapshot, "Hello from codex mock"), 1);
    // The prompt was echoed (codex emits no user message itself).
    assert!(snapshot.iter().any(|(method, params)| {
        method == "session/update"
            && params
                .pointer("/update/sessionUpdate")
                .and_then(Value::as_str)
                == Some("user_message_chunk")
            && params
                .pointer("/update/content/text")
                .and_then(Value::as_str)
                == Some("Say hello")
    }));
    // The read-only command surfaced as a tool_call with kind read, then completed.
    assert!(snapshot.iter().any(|(method, params)| {
        method == "session/update"
            && params
                .pointer("/update/sessionUpdate")
                .and_then(Value::as_str)
                == Some("tool_call")
            && params.pointer("/update/kind").and_then(Value::as_str) == Some("read")
            && params.pointer("/update/toolCallId").and_then(Value::as_str) == Some("item-1")
    }));
    // Usage flows out both as the gauge update and the turn_complete totals.
    assert!(snapshot.iter().any(|(method, params)| {
        method == "_posthog/usage_update" && params.get("used").and_then(Value::as_u64) == Some(30)
    }));
    let turn_complete = snapshot
        .iter()
        .find(|(m, _)| m == "_posthog/turn_complete")
        .map(|(_, p)| p.clone())
        .unwrap();
    assert_eq!(turn_complete["stopReason"], "end_turn");
    assert_eq!(turn_complete["usage"]["totalTokens"], 30);
}

#[tokio::test]
async fn command_approval_relays_and_maps_the_decision() {
    let (peer, recorded) = spawn_driver("allow");
    let session_id = new_session(&peer, json!({})).await;

    request(
        &peer,
        "session/prompt",
        json!({
            "sessionId": session_id,
            "prompt": [{ "type": "text", "text": "please APPROVE_CMD now" }],
        }),
    )
    .await;

    wait_for(
        &recorded,
        |r| agent_chunks(r, "decision:accept") >= 1,
        "approval decision echo",
    )
    .await;

    let permission = recorded
        .lock()
        .expect("recorded lock")
        .iter()
        .find(|(method, _)| method == "session/request_permission")
        .map(|(_, params)| params.clone())
        .expect("permission request relayed");
    assert_eq!(
        permission.pointer("/toolCall/title"),
        Some(&json!("rm -rf /tmp/scratch"))
    );
    assert_eq!(
        permission.pointer("/toolCall/kind"),
        Some(&json!("execute"))
    );
    let option_ids: Vec<&str> = permission["options"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|o| o.get("optionId").and_then(Value::as_str))
        .collect();
    // available_decisions offered a remember option, so allow_always shows.
    assert_eq!(
        option_ids,
        vec!["allow", "allow_always", "reject", "reject_with_feedback"]
    );
}

#[tokio::test]
async fn allow_always_echoes_the_remember_decision() {
    let (peer, recorded) = spawn_driver("allow_always");
    let session_id = new_session(&peer, json!({})).await;

    request(
        &peer,
        "session/prompt",
        json!({
            "sessionId": session_id,
            "prompt": [{ "type": "text", "text": "please APPROVE_CMD now" }],
        }),
    )
    .await;

    wait_for(
        &recorded,
        |r| agent_chunks(r, "decision:approved_for_session") >= 1,
        "remember decision echo",
    )
    .await;
}

#[tokio::test]
async fn session_resume_reopens_the_prior_thread() {
    let (peer, recorded) = spawn_driver("allow");
    let init = request(
        &peer,
        "initialize",
        json!({ "protocolVersion": 1, "clientCapabilities": {} }),
    )
    .await;
    assert_eq!(init["protocolVersion"], 1);

    let response = request(
        &peer,
        "_posthog/session/resume",
        json!({
            "sessionId": "mock-thread-42",
            "cwd": "/tmp",
            "mcpServers": [],
            "_meta": {
                "environment": "cloud",
                "taskRunId": "run-9",
                "systemPrompt": { "append": "cloud test prompt" },
            },
        }),
    )
    .await;
    // thread/resume echoes the prior thread id back as the session id.
    assert_eq!(response["sessionId"], "mock-thread-42");

    wait_for(
        &recorded,
        |r| {
            r.iter().any(|(m, p)| {
                m == "_posthog/sdk_session"
                    && p.get("sessionId").and_then(Value::as_str) == Some("mock-thread-42")
            })
        },
        "resumed sdk session notification",
    )
    .await;

    // A turn still runs on the resumed thread.
    let response = request(
        &peer,
        "session/prompt",
        json!({
            "sessionId": "mock-thread-42",
            "prompt": [{ "type": "text", "text": "Say hello" }],
        }),
    )
    .await;
    assert_eq!(response["stopReason"], "end_turn");
}

#[tokio::test]
async fn structured_output_parses_the_final_message() {
    let (peer, recorded) = spawn_driver("allow");
    let session_id = new_session(&peer, json!({ "jsonSchema": { "type": "object" } })).await;

    request(
        &peer,
        "session/prompt",
        json!({
            "sessionId": session_id,
            "prompt": [{ "type": "text", "text": "please STRUCTURED now" }],
        }),
    )
    .await;

    wait_for(
        &recorded,
        |r| {
            r.iter().any(|(m, p)| {
                m == "_posthog/structured_output"
                    && p.pointer("/output/answer").and_then(Value::as_u64) == Some(42)
            })
        },
        "structured output notification",
    )
    .await;
}
