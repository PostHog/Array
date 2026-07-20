//! Minimal ACP agent used by the agent-server integration tests.
//!
//! Speaks just enough of the protocol to exercise the server's session
//! lifecycle: `initialize`, `session/new`, and `session/prompt` (which emits
//! an agent_message_chunk pair, optionally raises a permission request, then
//! settles with `end_turn`). Behavior toggles via env vars:
//!
//! - `MOCK_AGENT_REQUEST_PERMISSION=1` — raise `session/request_permission`
//!   mid-turn and echo the outcome as a `_posthog/status` notification.
//! - `MOCK_AGENT_FAIL_PROMPT=<message>` — fail prompts with a JSON-RPC error.

use std::io::{BufRead, Write};

use serde_json::{json, Value};

fn send(message: Value) {
    let mut stdout = std::io::stdout().lock();
    writeln!(stdout, "{message}").expect("write to stdout");
    stdout.flush().expect("flush stdout");
}

fn notify(method: &str, params: Value) {
    send(json!({ "jsonrpc": "2.0", "method": method, "params": params }));
}

fn respond(id: &Value, result: Value) {
    send(json!({ "jsonrpc": "2.0", "id": id, "result": result }));
}

fn main() {
    let request_permission = std::env::var("MOCK_AGENT_REQUEST_PERMISSION").is_ok();
    let fail_prompt = std::env::var("MOCK_AGENT_FAIL_PROMPT").ok();

    let stdin = std::io::stdin().lock();
    let mut next_permission_id: u64 = 1000;

    for line in stdin.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };

        let method = message.get("method").and_then(Value::as_str);
        let id = message.get("id").cloned();

        match (method, id) {
            (Some("initialize"), Some(id)) => {
                respond(
                    &id,
                    json!({ "protocolVersion": 1, "agentCapabilities": {} }),
                );
            }
            (Some("session/new"), Some(id)) => {
                respond(&id, json!({ "sessionId": "sess_mock_1" }));
            }
            (Some("session/prompt"), Some(id)) => {
                if let Some(fail_message) = &fail_prompt {
                    send(json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32000, "message": fail_message },
                    }));
                    continue;
                }

                let session_id = message
                    .pointer("/params/sessionId")
                    .and_then(Value::as_str)
                    .unwrap_or("sess_mock_1")
                    .to_string();

                notify(
                    "session/update",
                    json!({
                        "sessionId": session_id,
                        "update": {
                            "sessionUpdate": "agent_message_chunk",
                            "content": { "type": "text", "text": "Hello from the " },
                        },
                    }),
                );
                notify(
                    "session/update",
                    json!({
                        "sessionId": session_id,
                        "update": {
                            "sessionUpdate": "agent_message_chunk",
                            "content": { "type": "text", "text": "mock agent" },
                        },
                    }),
                );

                if request_permission {
                    next_permission_id += 1;
                    send(json!({
                        "jsonrpc": "2.0",
                        "id": next_permission_id,
                        "method": "session/request_permission",
                        "params": {
                            "sessionId": session_id,
                            "options": [
                                { "optionId": "allow", "kind": "allow_once", "name": "Allow" },
                                { "optionId": "reject", "kind": "reject_once", "name": "Reject" },
                            ],
                            "toolCall": { "toolCallId": "tool_1", "kind": "execute" },
                        },
                    }));
                    // The permission response arrives as a JSON-RPC response
                    // on stdin; the read loop below sees it (no method) and
                    // publishes it for test assertions.
                }

                respond(&id, json!({ "stopReason": "end_turn" }));
            }
            (Some("session/cancel"), None) => {
                notify("_posthog/status", json!({ "status": "cancelled" }));
            }
            (Some(other), Some(id)) => {
                send(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": format!("Method not found: {other}") },
                }));
            }
            (None, Some(_)) => {
                // A response to one of our own requests (permission outcome):
                // surface it as a notification so tests can observe it.
                if let Some(result) = message.get("result") {
                    notify("_posthog/status", json!({ "permissionOutcome": result }));
                }
            }
            _ => {}
        }
    }
}
