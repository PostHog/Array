//! End-to-end contract tests: a real `AgentServer` over HTTP, a real ACP
//! subprocess (`mock-acp-agent`), and a mock PostHog API. These assert the
//! wire contracts Django and clients depend on (see rust/README.md).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::{Path, State};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use posthog_agent_server::config::{AgentMode, RuntimeAdapter, ServerConfig};
use posthog_agent_server::http::build_router;
use posthog_agent_server::jwt::{validate_jwt, JwtErrorCode};
use posthog_agent_server::server::AgentServer;
use serde_json::{json, Value};

const TEST_PRIVATE_KEY: &str = include_str!("fixtures/test_jwt_private.pem");
const TEST_PUBLIC_KEY: &str = include_str!("fixtures/test_jwt_public.pem");

#[derive(Default)]
struct Recorded {
    run_patches: Vec<Value>,
    relayed_messages: Vec<Value>,
    log_entries: Vec<Value>,
    ingest_bodies: Vec<String>,
}

#[derive(Clone)]
struct MockPostHog {
    task_description: String,
    run_state: Value,
    recorded: Arc<Mutex<Recorded>>,
}

async fn start_mock_posthog(task_description: &str, run_state: Value) -> (String, MockPostHog) {
    let mock = MockPostHog {
        task_description: task_description.to_string(),
        run_state,
        recorded: Arc::new(Mutex::new(Recorded::default())),
    };

    let router = Router::new()
        .route(
            "/api/projects/{project}/tasks/{task}/",
            get(|State(mock): State<MockPostHog>| async move {
                Json(json!({
                    "id": "task_1",
                    "title": "Test task",
                    "description": mock.task_description,
                    "internal": false,
                }))
            }),
        )
        .route(
            "/api/projects/{project}/tasks/{task}/runs/{run}/",
            get(|State(mock): State<MockPostHog>| async move {
                Json(json!({ "id": "run_1", "status": "queued", "state": mock.run_state }))
            })
            .patch(
                |State(mock): State<MockPostHog>, Json(body): Json<Value>| async move {
                    mock.recorded.lock().unwrap().run_patches.push(body);
                    Json(json!({}))
                },
            ),
        )
        .route(
            "/api/projects/{project}/tasks/{task}/runs/{run}/set_output/",
            patch(
                |State(mock): State<MockPostHog>, Json(body): Json<Value>| async move {
                    mock.recorded.lock().unwrap().run_patches.push(body);
                    Json(json!({}))
                },
            ),
        )
        .route(
            "/api/projects/{project}/tasks/{task}/runs/{run}/append_log/",
            post(
                |State(mock): State<MockPostHog>, Json(body): Json<Value>| async move {
                    if let Some(entries) = body.get("entries").and_then(Value::as_array) {
                        mock.recorded
                            .lock()
                            .unwrap()
                            .log_entries
                            .extend(entries.iter().cloned());
                    }
                    Json(json!({}))
                },
            ),
        )
        .route(
            "/api/projects/{project}/tasks/{task}/runs/{run}/relay_message/",
            post(
                |State(mock): State<MockPostHog>, Json(body): Json<Value>| async move {
                    mock.recorded.lock().unwrap().relayed_messages.push(body);
                    Json(json!({ "status": "ok" }))
                },
            ),
        )
        .route(
            "/api/projects/{project}/tasks/{task}/runs/{run}/event_stream/",
            post(
                |Path(_): Path<HashMap<String, String>>,
                 State(mock): State<MockPostHog>,
                 body: String| async move {
                    mock.recorded.lock().unwrap().ingest_bodies.push(body);
                    Json(json!({ "last_accepted_seq": 0 }))
                },
            ),
        )
        .with_state(mock.clone());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (format!("http://{addr}"), mock)
}

fn test_config(api_url: &str, mode: AgentMode, adapter_cmd: &str) -> ServerConfig {
    ServerConfig {
        port: 0,
        repository_path: None,
        repo_ready_file: None,
        api_url: api_url.to_string(),
        api_key: "phx_test".to_string(),
        project_id: 2,
        jwt_public_key: TEST_PUBLIC_KEY.to_string(),
        event_ingest_token: None,
        event_ingest_base_url: None,
        event_ingest_stream_window_ms: None,
        event_ingest_keep_stream_open: None,
        mode,
        task_id: "task_1".to_string(),
        run_id: "run_1".to_string(),
        create_pr: None,
        auto_publish: None,
        mcp_servers: Vec::new(),
        base_branch: None,
        claude_code: None,
        allowed_domains: None,
        runtime_adapter: RuntimeAdapter::Claude,
        model: None,
        reasoning_effort: None,
        adapter_cmd: adapter_cmd.to_string(),
        resume_run_id: None,
        interaction_origin: None,
        llm_gateway_url_override: Some("http://localhost:1/gateway".to_string()),
        hostname: None,
    }
}

async fn start_agent_server(config: ServerConfig) -> (Arc<AgentServer>, String) {
    let server = AgentServer::new(config);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = build_router(Arc::clone(&server));
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (server, format!("http://{addr}"))
}

fn sign_jwt(run_id: &str, mode: &str) -> String {
    let now = chrono::Utc::now().timestamp();
    let claims = json!({
        "run_id": run_id,
        "task_id": "task_1",
        "team_id": 2,
        "user_id": 7,
        "distinct_id": "user-7",
        "mode": mode,
        "aud": "posthog:sandbox_connection",
        "iat": now,
        "exp": now + 3600,
    });
    jsonwebtoken::encode(
        &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256),
        &claims,
        &jsonwebtoken::EncodingKey::from_rsa_pem(TEST_PRIVATE_KEY.as_bytes()).unwrap(),
    )
    .unwrap()
}

/// Reads SSE frames off a response stream until `predicate` matches a data
/// frame (returning all data frames seen), or panics on timeout.
async fn read_sse_until(
    response: reqwest::Response,
    timeout: Duration,
    predicate: impl Fn(&Value) -> bool,
) -> Vec<Value> {
    use futures::StreamExt;

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut frames = Vec::new();

    let result = tokio::time::timeout(timeout, async {
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.expect("SSE chunk");
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(pos) = buffer.find("\n\n") {
                let frame: String = buffer.drain(..pos + 2).collect();
                let frame = frame.trim();
                if let Some(data) = frame.strip_prefix("data: ") {
                    let value: Value = serde_json::from_str(data).expect("SSE data JSON");
                    let done = predicate(&value);
                    frames.push(value);
                    if done {
                        return;
                    }
                }
            }
        }
        panic!("SSE stream ended before predicate matched");
    })
    .await;
    result.unwrap_or_else(|_| {
        panic!(
            "timed out waiting for SSE frame; saw {} frames: {}",
            frames.len(),
            serde_json::to_string_pretty(&frames).unwrap_or_default()
        )
    });
    frames
}

fn notification_method(frame: &Value) -> Option<&str> {
    if frame.get("type")?.as_str()? != "notification" {
        return None;
    }
    frame.pointer("/notification/method")?.as_str()
}

fn mock_agent_cmd(extra_env: &str) -> String {
    let bin = env!("CARGO_BIN_EXE_mock-acp-agent");
    if extra_env.is_empty() {
        bin.to_string()
    } else {
        format!("{extra_env} {bin}")
    }
}

#[tokio::test]
async fn background_run_full_lifecycle() {
    let (api_url, mock) = start_mock_posthog("Do the thing", json!({})).await;
    let config = test_config(&api_url, AgentMode::Background, &mock_agent_cmd(""));
    let (server, base_url) = start_agent_server(config).await;

    let client = reqwest::Client::new();

    // Health before init: ok, no session.
    let health: Value = client
        .get(format!("{base_url}/health"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health["status"], "ok");
    assert_eq!(health["hasSession"], false);

    server
        .auto_initialize_session()
        .await
        .expect("session init");

    // Health after init: hasSession plus boot metrics Django records.
    let health: Value = client
        .get(format!("{base_url}/health"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health["status"], "ok");
    assert_eq!(health["hasSession"], true);
    assert!(health["bootMs"].is_number());
    assert!(health["sessionInitMs"].is_number());

    // Unauthenticated SSE is rejected with the coded 401 body.
    let unauthorized = client
        .get(format!("{base_url}/events"))
        .send()
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), 401);
    let body: Value = unauthorized.json().await.unwrap();
    assert_eq!(body["code"], "invalid_token");
    assert_eq!(body["error"], "Missing authorization header");

    // Authenticated SSE replays buffered events: run_started, setup progress,
    // the initial turn's traffic, then turn_complete.
    let token = sign_jwt("run_1", "background");
    let events = client
        .get(format!("{base_url}/events"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(events.status(), 200);
    assert_eq!(
        events.headers().get("content-type").unwrap(),
        "text/event-stream"
    );

    let frames = read_sse_until(events, Duration::from_secs(15), |frame| {
        notification_method(frame) == Some("_posthog/turn_complete")
    })
    .await;

    let methods: Vec<&str> = frames.iter().filter_map(notification_method).collect();
    assert!(
        methods.contains(&"_posthog/run_started"),
        "methods: {methods:?}"
    );
    assert!(
        methods.contains(&"_posthog/progress"),
        "methods: {methods:?}"
    );
    assert!(methods.contains(&"session/update"), "methods: {methods:?}");

    let run_started = frames
        .iter()
        .find(|f| notification_method(f) == Some("_posthog/run_started"))
        .unwrap();
    assert_eq!(
        run_started.pointer("/notification/params/runId").unwrap(),
        "run_1"
    );
    assert_eq!(
        run_started
            .pointer("/notification/params/sessionId")
            .unwrap(),
        "sess_mock_1"
    );
    assert!(run_started
        .pointer("/notification/params/agentVersion")
        .and_then(Value::as_str)
        .unwrap()
        .ends_with("-rs"));

    let turn_complete = frames.last().unwrap();
    assert_eq!(
        turn_complete
            .pointer("/notification/params/stopReason")
            .unwrap(),
        "end_turn"
    );

    // Follow-up user message over POST /command.
    let response: Value = client
        .post(format!("{base_url}/command"))
        .bearer_auth(&token)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 42,
            "method": "user_message",
            "params": { "content": "Follow up please", "messageId": "msg-1" },
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(response["jsonrpc"], "2.0");
    assert_eq!(response["id"], 42);
    assert_eq!(response["result"]["stopReason"], "end_turn");
    assert_eq!(
        response["result"]["assistant_message"],
        "Hello from the mock agent"
    );

    // Duplicate delivery is acknowledged without a second turn.
    let duplicate: Value = client
        .post(format!("{base_url}/command"))
        .bearer_auth(&token)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 43,
            "method": "user_message",
            "params": { "content": "Follow up please", "messageId": "msg-1" },
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(duplicate["result"]["duplicate"], true);

    // Unknown method → -32602 with the TS error string.
    let unknown: Value = client
        .post(format!("{base_url}/command"))
        .bearer_auth(&token)
        .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": "frobnicate" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(unknown["error"]["code"], -32602);
    assert_eq!(unknown["error"]["message"], "Unknown method: frobnicate");

    // Malformed JSON-RPC → HTTP 400.
    let malformed = client
        .post(format!("{base_url}/command"))
        .bearer_auth(&token)
        .json(&json!({ "method": "cancel" }))
        .send()
        .await
        .unwrap();
    assert_eq!(malformed.status(), 400);
    let body: Value = malformed.json().await.unwrap();
    assert_eq!(body["error"], "Invalid JSON-RPC request");

    // A token for another run cannot command this session.
    let foreign = client
        .post(format!("{base_url}/command"))
        .bearer_auth(sign_jwt("run_other", "background"))
        .json(&json!({ "jsonrpc": "2.0", "id": 1, "method": "cancel" }))
        .send()
        .await
        .unwrap();
    assert_eq!(foreign.status(), 400);
    let body: Value = foreign.json().await.unwrap();
    assert_eq!(body["error"], "No active session for this run");

    // Cancel round-trips.
    let cancelled: Value = client
        .post(format!("{base_url}/command"))
        .bearer_auth(&token)
        .json(&json!({ "jsonrpc": "2.0", "id": 2, "method": "cancel" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(cancelled["result"]["cancelled"], true);

    // 404 shape.
    let missing = client.get(format!("{base_url}/nope")).send().await.unwrap();
    assert_eq!(missing.status(), 404);
    let body: Value = missing.json().await.unwrap();
    assert_eq!(body["error"], "Not found");

    // Give async log flushes a moment, then check the Django-side effects:
    // status in_progress PATCH and the initial-turn Slack relay.
    tokio::time::sleep(Duration::from_millis(700)).await;
    {
        let recorded = mock.recorded.lock().unwrap();
        assert!(
            recorded
                .run_patches
                .iter()
                .any(|patch| patch["status"] == "in_progress"),
            "patches: {:?}",
            recorded.run_patches
        );
        assert!(
            recorded
                .relayed_messages
                .iter()
                .any(|message| message["text"] == "Hello from the mock agent"),
            "relayed: {:?}",
            recorded.relayed_messages
        );
        assert!(
            recorded.log_entries.iter().any(|entry| {
                entry
                    .pointer("/notification/method")
                    .and_then(Value::as_str)
                    == Some("_posthog/run_started")
            }),
            "log entries missing run_started"
        );
        // Chunks must be coalesced into a single agent_message log entry.
        assert!(
            recorded.log_entries.iter().any(|entry| {
                entry
                    .pointer("/notification/params/update/sessionUpdate")
                    .and_then(Value::as_str)
                    == Some("agent_message")
                    && entry
                        .pointer("/notification/params/update/content/text")
                        .and_then(Value::as_str)
                        == Some("Hello from the mock agent")
            }),
            "log entries missing coalesced agent_message"
        );
        assert!(
            !recorded.log_entries.iter().any(|entry| {
                entry
                    .pointer("/notification/params/update/sessionUpdate")
                    .and_then(Value::as_str)
                    == Some("agent_message_chunk")
            }),
            "chunk entries must not be persisted"
        );
    }

    server.stop().await;
}

#[tokio::test]
async fn interactive_permission_relay_roundtrip() {
    // Empty description: no initial turn, so the only permission request is
    // the one raised by the follow-up prompt below.
    let (api_url, _mock) =
        start_mock_posthog("", json!({ "initial_permission_mode": "default" })).await;
    let config = test_config(
        &api_url,
        AgentMode::Interactive,
        &mock_agent_cmd("MOCK_AGENT_REQUEST_PERMISSION=1"),
    );
    let (server, base_url) = start_agent_server(config).await;
    server
        .auto_initialize_session()
        .await
        .expect("session init");

    let client = reqwest::Client::new();
    let token = sign_jwt("run_1", "interactive");

    let events = client
        .get(format!("{base_url}/events"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();

    // Fire the user message; it blocks on the permission round-trip.
    let command_task = {
        let client = client.clone();
        let base_url = base_url.clone();
        let token = token.clone();
        tokio::spawn(async move {
            client
                .post(format!("{base_url}/command"))
                .bearer_auth(&token)
                .json(&json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "user_message",
                    "params": { "content": "do something requiring approval" },
                }))
                .send()
                .await
                .unwrap()
                .json::<Value>()
                .await
                .unwrap()
        })
    };

    let frames = read_sse_until(events, Duration::from_secs(15), |frame| {
        frame.get("type").and_then(Value::as_str) == Some("permission_request")
    })
    .await;
    let permission_request = frames.last().unwrap();
    let request_id = permission_request["requestId"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        permission_request.pointer("/toolCall/toolCallId").unwrap(),
        "tool_1"
    );

    let resolved: Value = client
        .post(format!("{base_url}/command"))
        .bearer_auth(&token)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "permission_response",
            "params": { "requestId": request_id, "optionId": "allow" },
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(resolved["result"]["resolved"], true);

    let response = command_task.await.unwrap();
    assert_eq!(response["result"]["stopReason"], "end_turn");

    // Unknown requestId is the TS error string.
    let unknown: Value = client
        .post(format!("{base_url}/command"))
        .bearer_auth(&token)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "permission_response",
            "params": { "requestId": "nope", "optionId": "allow" },
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        unknown["error"]["message"],
        "No pending permission request found for id: nope"
    );

    server.stop().await;
}

#[tokio::test]
async fn ingest_receives_sequenced_events_and_completion_sentinel() {
    let (api_url, mock) = start_mock_posthog("Do the thing", json!({})).await;
    let mut config = test_config(&api_url, AgentMode::Background, &mock_agent_cmd(""));
    config.event_ingest_token = Some("ingest-token".to_string());
    let (server, _base_url) = start_agent_server(config).await;

    server
        .auto_initialize_session()
        .await
        .expect("session init");

    // Let the initial turn finish, then stop — the durable stream closes with
    // the completion sentinel.
    tokio::time::sleep(Duration::from_millis(1500)).await;
    server.stop().await;

    let bodies = mock.recorded.lock().unwrap().ingest_bodies.clone();
    let all_lines: Vec<Value> = bodies
        .iter()
        .flat_map(|body| body.lines())
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str::<Value>(line).expect("ndjson line"))
        .collect();
    assert!(!all_lines.is_empty(), "no ingest lines received");

    let seqs: Vec<u64> = all_lines
        .iter()
        .filter_map(|line| line.get("seq").and_then(Value::as_u64))
        .collect();
    assert_eq!(
        seqs.first(),
        Some(&1),
        "sequences must start at 1: {seqs:?}"
    );
    assert!(
        seqs.windows(2).all(|w| w[1] == w[0] + 1),
        "sequences must be contiguous: {seqs:?}"
    );

    assert!(
        all_lines.iter().any(|line| {
            line.pointer("/event/notification/method")
                .and_then(Value::as_str)
                == Some("_posthog/run_started")
        }),
        "ingest missing run_started"
    );

    let sentinel = all_lines.last().unwrap();
    assert_eq!(sentinel["type"], "_posthog/stream_complete");
    assert_eq!(sentinel["final_seq"].as_u64(), Some(*seqs.last().unwrap()));
}

#[test]
fn jwt_validation_contract() {
    let token = sign_jwt("run_1", "background");
    let payload = validate_jwt(&token, TEST_PUBLIC_KEY).unwrap();
    assert_eq!(payload.run_id, "run_1");
    assert_eq!(payload.task_id, "task_1");
    assert_eq!(payload.team_id, 2);
    assert_eq!(payload.user_id, 7);
    assert_eq!(payload.mode, "background");

    // Garbage token.
    let err = validate_jwt("garbage", TEST_PUBLIC_KEY).unwrap_err();
    assert_eq!(err.code.as_str(), JwtErrorCode::InvalidSignature.as_str());

    // Wrong audience.
    let now = chrono::Utc::now().timestamp();
    let wrong_aud = jsonwebtoken::encode(
        &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256),
        &json!({
            "run_id": "run_1", "task_id": "task_1", "team_id": 2, "user_id": 7,
            "distinct_id": "d", "aud": "posthog:something_else", "exp": now + 3600,
        }),
        &jsonwebtoken::EncodingKey::from_rsa_pem(TEST_PRIVATE_KEY.as_bytes()).unwrap(),
    )
    .unwrap();
    assert!(validate_jwt(&wrong_aud, TEST_PUBLIC_KEY).is_err());

    // Expired.
    let expired = jsonwebtoken::encode(
        &jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256),
        &json!({
            "run_id": "run_1", "task_id": "task_1", "team_id": 2, "user_id": 7,
            "distinct_id": "d", "aud": "posthog:sandbox_connection",
            "exp": now - 3600, "iat": now - 7200,
        }),
        &jsonwebtoken::EncodingKey::from_rsa_pem(TEST_PRIVATE_KEY.as_bytes()).unwrap(),
    )
    .unwrap();
    let err = validate_jwt(&expired, TEST_PUBLIC_KEY).unwrap_err();
    assert_eq!(err.code.as_str(), "expired");
    assert_eq!(err.message, "Token expired");
}
