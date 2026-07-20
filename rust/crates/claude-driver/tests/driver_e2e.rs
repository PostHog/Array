//! End-to-end tests: a test harness plays the agent-server (ACP client over
//! an in-memory duplex), the driver under test spawns `mock-claude-cli` as
//! the Claude Code CLI. Covers the handshake, a streamed prompt turn with
//! consolidated-message dedupe, the canUseTool permission relay, and the
//! in-process MCP tools/list round trip.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use posthog_acp::{IncomingHandler, Peer, RpcError};
use posthog_claude_driver::cli::SidecarConfig;
use posthog_claude_driver::driver::Driver;
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
    // The driver resolves the CLI via CLAUDE_CODE_EXECUTABLE; point every test
    // at the mock binary (same value everywhere, so the set_var race between
    // parallel tests is benign).
    std::env::set_var(
        "CLAUDE_CODE_EXECUTABLE",
        env!("CARGO_BIN_EXE_mock-claude-cli"),
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

async fn new_session(peer: &Peer, permission_mode: &str) -> String {
    let init = request(
        peer,
        "initialize",
        json!({ "protocolVersion": 1, "clientCapabilities": {} }),
    )
    .await;
    assert_eq!(init["protocolVersion"], 1);

    let response = request(
        peer,
        "session/new",
        json!({
            "cwd": "/tmp",
            "mcpServers": [],
            "_meta": {
                "environment": "cloud",
                "permissionMode": permission_mode,
                "systemPrompt": { "append": "cloud test prompt" },
            },
        }),
    )
    .await;
    response["sessionId"]
        .as_str()
        .expect("session/new returns sessionId")
        .to_string()
}

#[tokio::test]
async fn prompt_turn_streams_chunks_and_settles() {
    let (peer, recorded) = spawn_driver("allow");
    let session_id = new_session(&peer, "bypassPermissions").await;

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
        |r| agent_chunks(r, "Hello from mock") >= 1,
        "agent message chunk",
    )
    .await;

    let snapshot = recorded.lock().expect("recorded lock").clone();
    // The consolidated assistant copy must be deduped against the stream.
    assert_eq!(agent_chunks(&snapshot, "Hello from mock"), 1);
    // The prompt was broadcast as a user_message_chunk before the turn.
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
    // Usage flows out as the _posthog extension notification.
    assert!(snapshot.iter().any(|(method, params)| {
        method == "_posthog/usage_update"
            && params.pointer("/used/inputTokens").and_then(Value::as_u64) == Some(10)
            && params.pointer("/used/outputTokens").and_then(Value::as_u64) == Some(5)
    }));
    // The CLI's session id is surfaced for native resume.
    assert!(snapshot.iter().any(|(method, params)| {
        method == "_posthog/sdk_session"
            && params.get("sdkSessionId").and_then(Value::as_str) == Some("mock-sdk-session")
    }));
}

#[tokio::test]
async fn can_use_tool_relays_permission_in_default_mode() {
    let (peer, recorded) = spawn_driver("allow");
    let session_id = new_session(&peer, "default").await;

    let response = request(
        &peer,
        "session/prompt",
        json!({
            "sessionId": session_id,
            "prompt": [{ "type": "text", "text": "please REQUEST_TOOL now" }],
        }),
    )
    .await;
    assert_eq!(response["stopReason"], "end_turn");

    wait_for(
        &recorded,
        |r| agent_chunks(r, "permission:allow") >= 1,
        "permission decision echo",
    )
    .await;

    let snapshot = recorded.lock().expect("recorded lock").clone();
    let permission = snapshot
        .iter()
        .find(|(method, _)| method == "session/request_permission")
        .map(|(_, params)| params.clone())
        .expect("permission request relayed");
    assert_eq!(
        permission.pointer("/toolCall/rawInput/command"),
        Some(&json!("echo hi"))
    );
    assert_eq!(
        permission.pointer("/toolCall/rawInput/toolName"),
        Some(&json!("Bash"))
    );
    let option_ids: Vec<&str> = permission["options"]
        .as_array()
        .expect("options array")
        .iter()
        .filter_map(|o| o.get("optionId").and_then(Value::as_str))
        .collect();
    assert_eq!(option_ids, vec!["allow", "allow_always", "reject"]);

    // ensureToolCallEmitted: the pending tool_call precedes the relay.
    assert!(snapshot.iter().any(|(method, params)| {
        method == "session/update"
            && params
                .pointer("/update/sessionUpdate")
                .and_then(Value::as_str)
                == Some("tool_call")
            && params.pointer("/update/toolCallId").and_then(Value::as_str) == Some("toolu_mock_1")
            && params.pointer("/update/status").and_then(Value::as_str) == Some("pending")
    }));
}

#[tokio::test]
async fn can_use_tool_denies_with_feedback_message() {
    let (peer, recorded) = spawn_driver("reject");
    let session_id = new_session(&peer, "default").await;

    request(
        &peer,
        "session/prompt",
        json!({
            "sessionId": session_id,
            "prompt": [{ "type": "text", "text": "please REQUEST_TOOL now" }],
        }),
    )
    .await;

    wait_for(
        &recorded,
        |r| agent_chunks(r, "permission:deny") >= 1,
        "denied decision echo",
    )
    .await;

    // The refusal also surfaces as a failed tool_call_update.
    let snapshot = recorded.lock().expect("recorded lock").clone();
    assert!(snapshot.iter().any(|(method, params)| {
        method == "session/update"
            && params
                .pointer("/update/sessionUpdate")
                .and_then(Value::as_str)
                == Some("tool_call_update")
            && params.pointer("/update/status").and_then(Value::as_str) == Some("failed")
            && params.pointer("/update/toolCallId").and_then(Value::as_str) == Some("toolu_mock_1")
    }));
}

#[tokio::test]
async fn bypass_mode_skips_the_permission_relay() {
    let (peer, recorded) = spawn_driver("reject");
    let session_id = new_session(&peer, "bypassPermissions").await;

    request(
        &peer,
        "session/prompt",
        json!({
            "sessionId": session_id,
            "prompt": [{ "type": "text", "text": "please REQUEST_TOOL now" }],
        }),
    )
    .await;

    wait_for(
        &recorded,
        |r| agent_chunks(r, "permission:allow") >= 1,
        "auto-approved decision echo",
    )
    .await;
    assert!(!recorded
        .lock()
        .expect("recorded lock")
        .iter()
        .any(|(method, _)| method == "session/request_permission"));
}

#[tokio::test]
async fn mcp_control_channel_serves_signed_git_tools() {
    let (peer, recorded) = spawn_driver("allow");
    let session_id = new_session(&peer, "bypassPermissions").await;

    request(
        &peer,
        "session/prompt",
        json!({
            "sessionId": session_id,
            "prompt": [{ "type": "text", "text": "please LIST_MCP now" }],
        }),
    )
    .await;

    // The local-tools server exposes the three signed-git tools.
    wait_for(
        &recorded,
        |r| agent_chunks(r, "mcp_tools:3") >= 1,
        "mcp tools/list count echo",
    )
    .await;
}

#[tokio::test]
async fn session_resume_reuses_the_prior_session_id() {
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
            "sessionId": "prior-sess-1",
            "cwd": "/tmp",
            "mcpServers": [],
            "_meta": {
                "environment": "cloud",
                "permissionMode": "bypassPermissions",
                "sessionId": "prior-sess-1",
                "systemPrompt": { "append": "cloud test prompt" },
            },
        }),
    )
    .await;
    assert_eq!(response["sessionId"], "prior-sess-1");

    // The mock CLI announces itself under the id it got via --resume, so
    // this proves the flag made it through argv.
    wait_for(
        &recorded,
        |r| {
            r.iter().any(|(m, p)| {
                m == "_posthog/sdk_session"
                    && p.get("sdkSessionId").and_then(Value::as_str) == Some("prior-sess-1")
            })
        },
        "resumed sdk session notification",
    )
    .await;

    // A turn still runs on the resumed session.
    let response = request(
        &peer,
        "session/prompt",
        json!({
            "sessionId": "prior-sess-1",
            "prompt": [{ "type": "text", "text": "Say hello" }],
        }),
    )
    .await;
    assert_eq!(response["stopReason"], "end_turn");
}
