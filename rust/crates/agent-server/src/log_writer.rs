//! Session log persistence to the PostHog API (`append_log`).
//!
//! Port of the API-path behavior of `packages/agent/src/session-log-writer.ts`:
//! `agent_message_chunk` coalescing into a single `agent_message` entry, empty
//! `agent_thought_chunk` filtering, rawInput-only `tool_call_update` snapshot
//! deferral, per-turn assistant text tracking (for the Slack relay), and
//! debounced batch flushes.
//!
//! The TS class also maintains a local JSONL cache (with its own
//! per-toolCallId merged-update coalescing), but the cloud server constructs
//! it without a `localCachePath` — that path is desktop-only and is
//! intentionally not ported here.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::iso_now;
use crate::posthog_api::PostHogApiClient;

const FLUSH_DEBOUNCE: Duration = Duration::from_millis(500);
const FLUSH_MAX_RETRIES: usize = 3;

#[derive(Default)]
struct ChunkBuffer {
    text: String,
    first_timestamp: String,
}

#[derive(Default)]
struct LogState {
    chunk_buffer: Option<ChunkBuffer>,
    pending_entries: Vec<Value>,
    /// rawInput-only tool_call_update snapshots held until a meaningful
    /// update for the same toolCallId arrives (keyed by toolCallId).
    pending_raw_input_snapshots: Vec<(String, Value)>,
    current_turn_messages: Vec<String>,
    last_agent_message: Option<String>,
    flush_scheduled: bool,
}

/// Per-run session log writer.
#[derive(Clone)]
pub struct SessionLogWriter {
    api: Arc<PostHogApiClient>,
    task_id: String,
    run_id: String,
    state: Arc<Mutex<LogState>>,
}

impl SessionLogWriter {
    pub fn new(api: Arc<PostHogApiClient>, task_id: &str, run_id: &str) -> Self {
        Self {
            api,
            task_id: task_id.to_string(),
            run_id: run_id.to_string(),
            state: Arc::new(Mutex::new(LogState::default())),
        }
    }

    /// Append a raw ACP line (already parsed by the peer — parse-once).
    pub async fn append(&self, message: &Value) {
        let mut state = self.state.lock().await;
        let timestamp = iso_now();

        // Persisted empty thought chunks poison session resume: they rebuild
        // into empty text blocks the API rejects with a 400.
        if is_empty_thought_chunk(message) {
            return;
        }

        if session_update_type(message) == Some("agent_message_chunk") {
            if let Some(text) = chunk_text(message) {
                match &mut state.chunk_buffer {
                    Some(buffer) => buffer.text.push_str(text),
                    None => {
                        state.chunk_buffer = Some(ChunkBuffer {
                            text: text.to_string(),
                            first_timestamp: timestamp,
                        })
                    }
                }
            }
            // Chunk events are never persisted individually.
            return;
        }

        // Non-chunk event: flush buffered chunks first. A direct
        // agent_message supersedes the partial chunks.
        if session_update_type(message) == Some("agent_message") {
            state.chunk_buffer = None;
        } else {
            emit_coalesced_message(&mut state);
        }

        if let Some(text) = agent_message_text(message) {
            state.last_agent_message = Some(text.to_string());
            state.current_turn_messages.push(text.to_string());
        }

        let entry = json!({
            "type": "notification",
            "timestamp": timestamp,
            "notification": message,
        });

        // Streaming rawInput-only tool_call_update snapshots re-send the full
        // growing input; hold the latest per toolCallId and only persist it if
        // the terminal update never carries rawInput itself.
        if let Some((tool_call_id, raw_input_only)) = tool_call_update_info(message) {
            if raw_input_only {
                state
                    .pending_raw_input_snapshots
                    .retain(|(id, _)| id != &tool_call_id);
                state
                    .pending_raw_input_snapshots
                    .push((tool_call_id, entry));
                return;
            }
            let has_raw_input = message.pointer("/params/update/rawInput").is_some();
            if let Some(pos) = state
                .pending_raw_input_snapshots
                .iter()
                .position(|(id, _)| id == &tool_call_id)
            {
                let (_, buffered) = state.pending_raw_input_snapshots.remove(pos);
                if !has_raw_input {
                    state.pending_entries.push(buffered);
                }
            }
        }

        state.pending_entries.push(entry);
        self.schedule_flush(&mut state);
    }

    /// Append a server-generated bare notification (run_started, progress,
    /// turn_complete, ...). Matches `appendRawLine` semantics.
    pub async fn append_notification(&self, notification: &Value) {
        self.append(notification).await;
    }

    fn schedule_flush(&self, state: &mut LogState) {
        if state.flush_scheduled {
            return;
        }
        state.flush_scheduled = true;
        let writer = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(FLUSH_DEBOUNCE).await;
            writer.flush().await;
        });
    }

    /// Flush pending entries (coalescing any buffered chunks first).
    pub async fn flush(&self) {
        let entries = {
            let mut state = self.state.lock().await;
            state.flush_scheduled = false;
            emit_coalesced_message(&mut state);
            // Drain held rawInput snapshots so a final flush never strands them.
            let snapshots: Vec<Value> = state
                .pending_raw_input_snapshots
                .drain(..)
                .map(|(_, entry)| entry)
                .collect();
            state.pending_entries.extend(snapshots);
            std::mem::take(&mut state.pending_entries)
        };
        if entries.is_empty() {
            return;
        }

        for attempt in 0..FLUSH_MAX_RETRIES {
            match self
                .api
                .append_task_run_log(&self.task_id, &self.run_id, entries.clone())
                .await
            {
                Ok(()) => return,
                Err(err) if attempt + 1 < FLUSH_MAX_RETRIES => {
                    tracing::warn!(error = %err, attempt, "append_log failed; retrying");
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
                Err(err) => {
                    tracing::warn!(error = %err, "append_log failed; dropping batch");
                    return;
                }
            }
        }
    }

    /// Reset per-turn assistant text tracking (called before each prompt).
    pub async fn reset_turn_messages(&self) {
        let mut state = self.state.lock().await;
        state.current_turn_messages.clear();
        state.chunk_buffer = None;
    }

    /// Joined assistant text for the current turn (Slack relay fallback).
    pub async fn full_agent_response(&self) -> Option<String> {
        let mut state = self.state.lock().await;
        emit_coalesced_message(&mut state);
        if state.current_turn_messages.is_empty() {
            return None;
        }
        Some(state.current_turn_messages.join("\n\n"))
    }

    /// Ordered assistant text blocks for the current turn — one entry per
    /// message between tool calls; the last is the post-tool answer.
    pub async fn agent_response_parts(&self) -> Vec<String> {
        let mut state = self.state.lock().await;
        emit_coalesced_message(&mut state);
        state.current_turn_messages.clone()
    }
}

fn emit_coalesced_message(state: &mut LogState) {
    let Some(buffer) = state.chunk_buffer.take() else {
        return;
    };
    state.last_agent_message = Some(buffer.text.clone());
    state.current_turn_messages.push(buffer.text.clone());
    state.pending_entries.push(json!({
        "type": "notification",
        "timestamp": buffer.first_timestamp,
        "notification": {
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "update": {
                    "sessionUpdate": "agent_message",
                    "content": { "type": "text", "text": buffer.text },
                },
            },
        },
    }));
}

fn session_update(message: &Value) -> Option<&Value> {
    if message.get("method")?.as_str()? != "session/update" {
        return None;
    }
    message.pointer("/params/update")
}

fn session_update_type(message: &Value) -> Option<&str> {
    session_update(message)?.get("sessionUpdate")?.as_str()
}

fn chunk_text(message: &Value) -> Option<&str> {
    let content = session_update(message)?.get("content")?;
    if content.get("type")?.as_str()? != "text" {
        return None;
    }
    content.get("text")?.as_str().filter(|t| !t.is_empty())
}

fn is_empty_thought_chunk(message: &Value) -> bool {
    if session_update_type(message) != Some("agent_thought_chunk") {
        return false;
    }
    let Some(content) = session_update(message).and_then(|u| u.get("content")) else {
        return true;
    };
    match content.get("type").and_then(Value::as_str) {
        Some("text") => content
            .get("text")
            .and_then(Value::as_str)
            .map(|t| t.trim().is_empty())
            .unwrap_or(true),
        _ => false,
    }
}

/// Direct (non-chunk) assistant text: an `agent_message` update.
fn agent_message_text(message: &Value) -> Option<&str> {
    if session_update_type(message)? != "agent_message" {
        return None;
    }
    chunk_text(message)
}

/// Returns `(toolCallId, is_raw_input_only)` for tool_call_update messages.
fn tool_call_update_info(message: &Value) -> Option<(String, bool)> {
    if session_update_type(message)? != "tool_call_update" {
        return None;
    }
    let update = session_update(message)?;
    let tool_call_id = update.get("toolCallId")?.as_str()?.to_string();
    let raw_input_only = update.get("rawInput").is_some()
        && update
            .as_object()
            .map(|map| {
                map.keys()
                    .all(|key| key == "sessionUpdate" || key == "toolCallId" || key == "rawInput")
            })
            .unwrap_or(false);
    Some((tool_call_id, raw_input_only))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(text: &str) -> Value {
        json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": { "update": { "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": text } } }
        })
    }

    fn tool_call() -> Value {
        json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": { "update": { "sessionUpdate": "tool_call", "toolCallId": "t1" } }
        })
    }

    fn writer() -> SessionLogWriter {
        let api = Arc::new(PostHogApiClient::new("http://localhost:1", 1, "k", "test"));
        SessionLogWriter::new(api, "task", "run")
    }

    #[tokio::test]
    async fn coalesces_chunks_into_agent_message_on_next_event() {
        let w = writer();
        w.append(&chunk("Hello ")).await;
        w.append(&chunk("world")).await;
        w.append(&tool_call()).await;

        let state = w.state.lock().await;
        assert_eq!(state.pending_entries.len(), 2);
        let coalesced = &state.pending_entries[0];
        assert_eq!(
            coalesced
                .pointer("/notification/params/update/sessionUpdate")
                .unwrap(),
            "agent_message"
        );
        assert_eq!(
            coalesced
                .pointer("/notification/params/update/content/text")
                .unwrap(),
            "Hello world"
        );
        assert_eq!(state.current_turn_messages, vec!["Hello world"]);
    }

    #[tokio::test]
    async fn turn_parts_track_text_between_tool_calls() {
        let w = writer();
        w.append(&chunk("Let me check")).await;
        w.append(&tool_call()).await;
        w.append(&chunk("The answer is 42")).await;

        assert_eq!(
            w.agent_response_parts().await,
            vec!["Let me check".to_string(), "The answer is 42".to_string()]
        );
        assert_eq!(
            w.full_agent_response().await.unwrap(),
            "Let me check\n\nThe answer is 42"
        );

        w.reset_turn_messages().await;
        assert!(w.full_agent_response().await.is_none());
    }

    #[tokio::test]
    async fn drops_empty_thought_chunks() {
        let w = writer();
        w.append(&json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": { "update": { "sessionUpdate": "agent_thought_chunk", "content": { "type": "text", "text": "  " } } }
        }))
        .await;
        assert!(w.state.lock().await.pending_entries.is_empty());
    }

    #[tokio::test]
    async fn holds_raw_input_only_snapshots_until_meaningful_update() {
        let w = writer();
        let raw_input_only = json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": { "update": { "sessionUpdate": "tool_call_update", "toolCallId": "t1", "rawInput": { "partial": true } } }
        });
        w.append(&raw_input_only).await;
        assert!(w.state.lock().await.pending_entries.is_empty());

        // Terminal update without rawInput: the buffered snapshot is persisted
        // ahead of it.
        let terminal = json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": { "update": { "sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "completed" } }
        });
        w.append(&terminal).await;
        let state = w.state.lock().await;
        assert_eq!(state.pending_entries.len(), 2);
        assert!(state.pending_entries[0]
            .pointer("/notification/params/update/rawInput")
            .is_some());
    }
}
