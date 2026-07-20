//! Mock Claude Code CLI for driver e2e tests.
//!
//! Speaks just enough of the stream-json control protocol to exercise the
//! driver: answers the initialize handshake, streams a text turn for every
//! user message, and — driven by markers in the prompt text — issues
//! `can_use_tool` and `mcp_message` control requests so tests cover the
//! permission relay and the in-process MCP server.
//!
//! Prompt markers (env-free so parallel tests can't race each other):
//! - `REQUEST_TOOL` — asks can_use_tool for a Bash call, then echoes the
//!   decision as `permission:<behavior>` text.
//! - `LIST_MCP` — sends tools/list to `posthog-code-tools` over the control
//!   channel, then echoes `mcp_tools:<count>`.

use std::io::{BufRead, Write as _};

use serde_json::{json, Value};

fn emit(value: Value) {
    let mut stdout = std::io::stdout().lock();
    writeln!(stdout, "{value}").expect("write stdout");
    stdout.flush().expect("flush stdout");
}

fn success_response(request_id: Value, payload: Value) -> Value {
    json!({
        "type": "control_response",
        "response": { "subtype": "success", "request_id": request_id, "response": payload },
    })
}

/// Block until the control_response for `request_id` arrives, answering any
/// interleaved control_requests with empty successes on the way.
fn wait_for_control_response(
    lines: &mut impl Iterator<Item = std::io::Result<String>>,
    request_id: &str,
) -> Option<Value> {
    for line in lines {
        let Ok(line) = line else { return None };
        let Ok(message) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        match message.get("type").and_then(Value::as_str) {
            Some("control_response") => {
                if message
                    .pointer("/response/request_id")
                    .and_then(Value::as_str)
                    == Some(request_id)
                {
                    return Some(message);
                }
            }
            Some("control_request") => {
                emit(success_response(
                    message.get("request_id").cloned().unwrap_or(Value::Null),
                    json!({}),
                ));
            }
            _ => {}
        }
    }
    None
}

fn prompt_text(message: &Value) -> String {
    message
        .pointer("/message/content")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|b| b.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn text_chunk(session_id: &Value, text: &str) -> Value {
    json!({
        "type": "stream_event",
        "session_id": session_id,
        "parent_tool_use_id": null,
        "event": {
            "type": "content_block_delta",
            "index": 0,
            "delta": { "type": "text_delta", "text": text },
        },
    })
}

fn handle_user(
    message: &Value,
    lines: &mut impl Iterator<Item = std::io::Result<String>>,
    request_counter: &mut u64,
) {
    let text = prompt_text(message);
    let session_id = message.get("session_id").cloned().unwrap_or(json!("mock"));

    if text.contains("LIST_MCP") {
        *request_counter += 1;
        let request_id = format!("mock_req_{request_counter}");
        emit(json!({
            "type": "control_request",
            "request_id": request_id,
            "request": {
                "subtype": "mcp_message",
                "server_name": "posthog-code-tools",
                "message": { "jsonrpc": "2.0", "id": 1, "method": "tools/list" },
            },
        }));
        let response = wait_for_control_response(lines, &request_id);
        let count = response
            .as_ref()
            .and_then(|r| r.pointer("/response/response/mcp_response/result/tools"))
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0);
        emit(text_chunk(&session_id, &format!("mcp_tools:{count}")));
    }

    if text.contains("REQUEST_TOOL") {
        *request_counter += 1;
        let request_id = format!("mock_req_{request_counter}");
        emit(json!({
            "type": "control_request",
            "request_id": request_id,
            "request": {
                "subtype": "can_use_tool",
                "tool_name": "Bash",
                "input": { "command": "echo hi" },
                "tool_use_id": "toolu_mock_1",
            },
        }));
        let response = wait_for_control_response(lines, &request_id);
        let behavior = response
            .as_ref()
            .and_then(|r| r.pointer("/response/response/behavior"))
            .and_then(Value::as_str)
            .unwrap_or("error")
            .to_string();
        emit(text_chunk(&session_id, &format!("permission:{behavior}")));
    }

    emit(text_chunk(&session_id, "Hello from mock"));
    // Consolidated assistant copy: the driver's drop-all filter must dedupe it.
    emit(json!({
        "type": "assistant",
        "session_id": session_id,
        "parent_tool_use_id": null,
        "message": {
            "role": "assistant",
            "content": [{ "type": "text", "text": "Hello from mock" }],
        },
    }));
    emit(json!({
        "type": "result",
        "subtype": "success",
        "is_error": false,
        "result": "done",
        "num_turns": 1,
        "duration_ms": 5,
        "duration_api_ms": 5,
        "stop_reason": null,
        "total_cost_usd": 0.01,
        "usage": {
            "input_tokens": 10,
            "output_tokens": 5,
            "cache_read_input_tokens": 2,
            "cache_creation_input_tokens": 1,
        },
        "session_id": session_id,
    }));
}

fn main() {
    // A resumed session announces itself under the resumed id, so tests can
    // assert `--resume` made it through argv.
    let args: Vec<String> = std::env::args().collect();
    let resumed_session_id = args
        .iter()
        .position(|a| a == "--resume")
        .and_then(|i| args.get(i + 1))
        .cloned();

    let stdin = std::io::stdin();
    let mut lines = stdin.lock().lines();
    let mut request_counter: u64 = 0;
    let mut init_seen = false;

    while let Some(Ok(line)) = lines.next() {
        let Ok(message) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        match message.get("type").and_then(Value::as_str) {
            Some("control_request") => {
                let request_id = message.get("request_id").cloned().unwrap_or(Value::Null);
                let subtype = message
                    .pointer("/request/subtype")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                emit(success_response(request_id, json!({})));
                if subtype == "initialize" && !init_seen {
                    init_seen = true;
                    emit(json!({
                        "type": "system",
                        "subtype": "init",
                        "session_id": resumed_session_id.as_deref().unwrap_or("mock-sdk-session"),
                        "cwd": "/tmp",
                        "tools": [],
                        "model": "mock",
                        "permissionMode": "default",
                    }));
                }
            }
            Some("user") => handle_user(&message, &mut lines, &mut request_counter),
            _ => {}
        }
    }
}
