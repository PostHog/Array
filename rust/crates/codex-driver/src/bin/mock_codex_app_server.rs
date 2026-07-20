//! Mock codex app-server for driver e2e tests.
//!
//! Speaks just enough of the app-server JSON-RPC protocol (ndjson without the
//! `jsonrpc` header) to exercise the driver: initialize/thread/model/skills
//! handshakes, a streamed turn per `turn/start`, and — driven by markers in
//! the prompt text — a command-approval server request and a structured-output
//! final message.
//!
//! Prompt markers:
//! - `APPROVE_CMD` — asks item/commandExecution/requestApproval, then echoes
//!   the decision as a `decision:<decision>` message delta.
//! - `STRUCTURED` — the final agent message is a JSON object.

use std::io::{BufRead, Write as _};

use serde_json::{json, Value};

fn emit(value: Value) {
    let mut stdout = std::io::stdout().lock();
    writeln!(stdout, "{value}").expect("write stdout");
    stdout.flush().expect("flush stdout");
}

fn notify(method: &str, params: Value) {
    emit(json!({ "method": method, "params": params }));
}

fn respond(id: Value, result: Value) {
    emit(json!({ "id": id, "result": result }));
}

/// Block until the response for `request_id` arrives; the driver never sends
/// its own requests while we wait, so the loop only skips notifications.
fn wait_for_response(
    lines: &mut impl Iterator<Item = std::io::Result<String>>,
    request_id: &str,
) -> Option<Value> {
    for line in lines {
        let Ok(line) = line else { return None };
        let Ok(message) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if message.get("method").is_none()
            && message.get("id").and_then(Value::as_str) == Some(request_id)
        {
            return Some(message);
        }
    }
    None
}

fn input_text(params: &Value) -> String {
    params
        .get("input")
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

fn run_turn(
    params: &Value,
    lines: &mut impl Iterator<Item = std::io::Result<String>>,
    request_counter: &mut u64,
) {
    let text = input_text(params);
    notify("turn/started", json!({ "turn": { "id": "turn-1" } }));

    if text.contains("APPROVE_CMD") {
        *request_counter += 1;
        let request_id = format!("mock_req_{request_counter}");
        emit(json!({
            "id": request_id,
            "method": "item/commandExecution/requestApproval",
            "params": {
                "itemId": "item-cmd",
                "command": "rm -rf /tmp/scratch",
                "available_decisions": ["approved_for_session"],
            },
        }));
        let decision = wait_for_response(lines, &request_id)
            .and_then(|r| {
                r.pointer("/result/decision")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "error".to_string());
        notify(
            "item/agentMessage/delta",
            json!({ "itemId": "msg-1", "delta": format!("decision:{decision}") }),
        );
    }

    let final_text = if text.contains("STRUCTURED") {
        "{\"answer\": 42}".to_string()
    } else {
        "Hello from codex mock".to_string()
    };

    notify(
        "item/started",
        json!({ "item": {
            "type": "commandExecution",
            "id": "item-1",
            "command": "cat notes.txt",
            "commandActions": [{ "type": "read", "path": "/tmp/notes.txt" }],
        }}),
    );
    notify(
        "item/agentMessage/delta",
        json!({ "itemId": "msg-1", "delta": final_text }),
    );
    notify(
        "item/completed",
        json!({ "item": { "type": "agentMessage", "id": "msg-1", "text": final_text } }),
    );
    notify(
        "item/completed",
        json!({ "item": {
            "type": "commandExecution",
            "id": "item-1",
            "command": "cat notes.txt",
            "status": "completed",
            "aggregatedOutput": "the notes",
        }}),
    );
    notify(
        "thread/tokenUsage/updated",
        json!({ "tokenUsage": {
            "last": {
                "inputTokens": 20,
                "outputTokens": 7,
                "cachedInputTokens": 3,
                "totalTokens": 30,
            },
            "modelContextWindow": 272000,
        }}),
    );
    notify(
        "turn/completed",
        json!({ "turn": { "id": "turn-1", "status": "completed" } }),
    );
}

fn main() {
    let stdin = std::io::stdin();
    let mut lines = stdin.lock().lines();
    let mut request_counter: u64 = 0;

    while let Some(Ok(line)) = lines.next() {
        let Ok(message) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        let Some(method) = message.get("method").and_then(Value::as_str) else {
            continue;
        };
        let Some(id) = message.get("id").filter(|id| !id.is_null()).cloned() else {
            continue; // notification (e.g. `initialized`)
        };
        let params = message.get("params").cloned().unwrap_or(Value::Null);

        match method {
            "initialize" => respond(id, json!({})),
            "thread/start" => respond(id, json!({ "thread": { "id": "mock-thread-1" } })),
            "model/list" => respond(
                id,
                json!({ "data": [{
                    "id": "gpt-5.5",
                    "displayName": "GPT-5.5",
                    "owned_by": "openai",
                    "supportedReasoningEfforts": ["low", "medium", "high", "xhigh"],
                }]}),
            ),
            "skills/list" => respond(
                id,
                json!({ "data": [{ "skills": [
                    { "name": "review", "description": "Review code", "enabled": true },
                    { "name": "hidden", "description": "", "enabled": false },
                ]}]}),
            ),
            "turn/start" => {
                respond(id, json!({}));
                run_turn(&params, &mut lines, &mut request_counter);
            }
            "turn/steer" => respond(id, json!({ "turnId": "turn-1b" })),
            "turn/interrupt" => {
                respond(id, json!({}));
                notify(
                    "turn/completed",
                    json!({ "turn": { "id": "turn-1", "status": "interrupted" } }),
                );
            }
            _ => respond(id, json!({})),
        }
    }
}
