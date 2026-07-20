//! Session resume from the persisted run log.
//!
//! Port of `resume.ts` + `sagas/resume-saga.ts`: fetch the prior run's log,
//! rebuild the conversation from `session/update` notifications, find the
//! latest git checkpoint / session id / device, and format a token-budgeted
//! summary for the resume prompt. Native resume (Claude session JSONL
//! hydration) is a phase-2 concern; this is the summary path the TS server
//! falls back to whenever hydration is unavailable.

use serde_json::Value;

use crate::posthog_api::{ApiError, PostHogApiClient};

pub const RESUME_HISTORY_TOKEN_BUDGET: usize = 50_000;
const TOOL_RESULT_MAX_CHARS: usize = 2000;
const CHARS_PER_TOKEN: usize = 4;

const RESUME_CONTEXT_MARKERS: [&str; 3] = [
    "You are resuming a previous conversation",
    "Here is the conversation history from the",
    "Continue from where you left off",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
}

#[derive(Debug, Clone)]
pub struct ToolCallInfo {
    pub tool_call_id: String,
    pub tool_name: String,
    pub input: Option<Value>,
    pub result: Option<Value>,
}

#[derive(Debug, Clone)]
pub struct ConversationTurn {
    pub role: Role,
    pub content: Vec<Value>,
    pub tool_calls: Vec<ToolCallInfo>,
}

#[derive(Debug, Clone, Default)]
pub struct ResumeState {
    pub conversation: Vec<ConversationTurn>,
    pub latest_git_checkpoint: Option<Value>,
    pub log_entry_count: usize,
    pub session_id: Option<String>,
}

/// `resumeFromLog`: rebuild resume state from the prior run's log.
pub async fn resume_from_log(
    api: &PostHogApiClient,
    task_id: &str,
    run_id: &str,
) -> Result<ResumeState, ApiError> {
    let task_run = api.get_task_run(task_id, run_id).await?;
    if task_run.log_url.is_none() {
        tracing::info!("No log URL found, starting fresh");
        return Ok(ResumeState::default());
    }

    let entries = api.fetch_task_run_logs(task_id, run_id).await?;
    if entries.is_empty() {
        tracing::info!("No log entries found, starting fresh");
        return Ok(ResumeState::default());
    }
    tracing::info!(count = entries.len(), "Fetched log entries");

    Ok(ResumeState {
        latest_git_checkpoint: find_latest_git_checkpoint(&entries),
        session_id: find_session_id(&entries),
        conversation: rebuild_conversation(&entries),
        log_entry_count: entries.len(),
    })
}

fn notification(entry: &Value) -> Option<&Value> {
    entry.get("notification")
}

fn method(entry: &Value) -> Option<&str> {
    notification(entry)?.get("method")?.as_str()
}

/// Matches `method` against a `_posthog/*` name, tolerating the historical
/// `__posthog/*` double prefix in older logs.
fn method_matches(entry: &Value, expected: &str) -> bool {
    match method(entry) {
        Some(m) => m == expected || m == format!("_{expected}"),
        None => false,
    }
}

pub fn find_session_id(entries: &[Value]) -> Option<String> {
    entries.iter().rev().find_map(|entry| {
        if !method_matches(entry, "_posthog/run_started") {
            return None;
        }
        notification(entry)?
            .pointer("/params/sessionId")?
            .as_str()
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    })
}

pub fn find_latest_git_checkpoint(entries: &[Value]) -> Option<Value> {
    entries.iter().rev().find_map(|entry| {
        if !method_matches(entry, "_posthog/git_checkpoint") {
            return None;
        }
        let params = notification(entry)?.get("params")?;
        let valid = params.get("checkpointId").and_then(Value::as_str).is_some()
            && params
                .get("checkpointRef")
                .and_then(Value::as_str)
                .is_some();
        valid.then(|| params.clone())
    })
}

/// `rebuildConversation`: walk `session/update` entries into turns.
pub fn rebuild_conversation(entries: &[Value]) -> Vec<ConversationTurn> {
    let mut turns: Vec<ConversationTurn> = Vec::new();
    let mut assistant_content: Vec<Value> = Vec::new();
    let mut tool_calls: Vec<ToolCallInfo> = Vec::new();

    fn flush_assistant(
        turns: &mut Vec<ConversationTurn>,
        content: &mut Vec<Value>,
        tool_calls: &mut Vec<ToolCallInfo>,
    ) {
        if content.is_empty() && tool_calls.is_empty() {
            return;
        }
        turns.push(ConversationTurn {
            role: Role::Assistant,
            content: std::mem::take(content),
            tool_calls: std::mem::take(tool_calls),
        });
    }

    fn append_text(content: &mut Vec<Value>, block: &Value) {
        let is_text = block.get("type").and_then(Value::as_str) == Some("text");
        if is_text {
            if let Some(last) = content.last_mut() {
                if last.get("type").and_then(Value::as_str) == Some("text") {
                    let addition = block
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let existing = last.get("text").and_then(Value::as_str).map(str::to_string);
                    if let Some(text) = existing {
                        last["text"] = Value::String(format!("{text}{addition}"));
                        return;
                    }
                }
            }
        }
        content.push(block.clone());
    }

    for entry in entries {
        let Some(notification) = notification(entry) else {
            continue;
        };
        if notification.get("method").and_then(Value::as_str) != Some("session/update") {
            continue;
        }
        let Some(update) = notification.pointer("/params/update") else {
            continue;
        };
        let session_update = update.get("sessionUpdate").and_then(Value::as_str);

        match session_update {
            Some("user_message") | Some("user_message_chunk") => {
                flush_assistant(&mut turns, &mut assistant_content, &mut tool_calls);
                let content = match update.get("content") {
                    Some(Value::Array(items)) => items.clone(),
                    Some(other) => vec![other.clone()],
                    None => Vec::new(),
                };
                turns.push(ConversationTurn {
                    role: Role::User,
                    content,
                    tool_calls: Vec::new(),
                });
            }
            // agent_message_chunk kept for older logs with individual chunks.
            Some("agent_message") | Some("agent_message_chunk") => {
                if let Some(content) = update.get("content") {
                    append_text(&mut assistant_content, content);
                }
            }
            Some("tool_call") | Some("tool_call_update") => {
                let Some(meta) = update.pointer("/_meta/claudeCode") else {
                    continue;
                };
                let (Some(tool_call_id), Some(tool_name)) = (
                    meta.get("toolCallId").and_then(Value::as_str),
                    meta.get("toolName").and_then(Value::as_str),
                ) else {
                    continue;
                };
                let existing = tool_calls
                    .iter_mut()
                    .find(|tc| tc.tool_call_id == tool_call_id);
                let tool_call = match existing {
                    Some(tc) => tc,
                    None => {
                        tool_calls.push(ToolCallInfo {
                            tool_call_id: tool_call_id.to_string(),
                            tool_name: tool_name.to_string(),
                            input: meta.get("toolInput").cloned(),
                            result: None,
                        });
                        tool_calls.last_mut().expect("just pushed")
                    }
                };
                if let Some(response) = meta.get("toolResponse") {
                    tool_call.result = Some(response.clone());
                }
            }
            Some("tool_result") => {
                let Some(meta) = update.pointer("/_meta/claudeCode") else {
                    continue;
                };
                let Some(tool_call_id) = meta.get("toolCallId").and_then(Value::as_str) else {
                    continue;
                };
                if let Some(response) = meta.get("toolResponse") {
                    if let Some(tc) = tool_calls
                        .iter_mut()
                        .find(|tc| tc.tool_call_id == tool_call_id)
                    {
                        tc.result = Some(response.clone());
                    }
                }
            }
            _ => {}
        }
    }

    flush_assistant(&mut turns, &mut assistant_content, &mut tool_calls);
    turns
}

fn turn_text(turn: &ConversationTurn) -> String {
    turn.content
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect()
}

fn is_resume_context_turn(turn: &ConversationTurn) -> bool {
    if turn.role != Role::User {
        return false;
    }
    let text = turn_text(turn);
    RESUME_CONTEXT_MARKERS
        .iter()
        .any(|marker| text.contains(marker))
}

fn estimate_turn_tokens(turn: &ConversationTurn) -> usize {
    let mut chars = 0;
    for block in &turn.content {
        if let Some(text) = block.get("text").and_then(Value::as_str) {
            chars += text.len();
        }
    }
    for tc in &turn.tool_calls {
        chars += tc.input.as_ref().map(|v| v.to_string().len()).unwrap_or(2);
        if let Some(result) = &tc.result {
            chars += match result {
                Value::String(s) => s.len(),
                other => other.to_string().len(),
            };
        }
    }
    chars.div_ceil(CHARS_PER_TOKEN)
}

/// `selectRecentTurns`: keep the most recent turns within the token budget,
/// starting on a user turn. When even the newest turn alone exceeds the
/// budget, keep the nearest user turn (the task intent) and shed the
/// assistant turn's oldest tool calls until it fits.
pub fn select_recent_turns(turns: &[ConversationTurn], max_tokens: usize) -> Vec<ConversationTurn> {
    let mut budget = max_tokens as i64;
    let mut start_index = turns.len();

    for i in (0..turns.len()).rev() {
        let cost = estimate_turn_tokens(&turns[i]) as i64;
        if cost > budget {
            break;
        }
        budget -= cost;
        start_index = i;
    }

    if start_index == turns.len() && !turns.is_empty() {
        return select_oversized_tail_fallback(turns, max_tokens);
    }

    while start_index < turns.len() && turns[start_index].role != Role::User {
        start_index += 1;
    }

    turns[start_index..].to_vec()
}

fn select_oversized_tail_fallback(
    turns: &[ConversationTurn],
    max_tokens: usize,
) -> Vec<ConversationTurn> {
    let last_user = turns.iter().rev().find(|t| t.role == Role::User).cloned();
    let mut last_turn = turns.last().expect("non-empty").clone();

    while estimate_turn_tokens(&last_turn) > max_tokens && !last_turn.tool_calls.is_empty() {
        last_turn.tool_calls.remove(0);
    }

    let mut result = Vec::new();
    if let Some(user) = last_user {
        if user.content != last_turn.content || user.role != last_turn.role {
            result.push(user);
        }
    }
    result.push(last_turn);
    result
}

/// `formatConversationForResume`.
pub fn format_conversation_for_resume(conversation: &[ConversationTurn]) -> String {
    let filtered: Vec<&ConversationTurn> = conversation
        .iter()
        .filter(|t| !is_resume_context_turn(t))
        .collect();
    let owned: Vec<ConversationTurn> = filtered.iter().map(|t| (*t).clone()).collect();
    let selected = select_recent_turns(&owned, RESUME_HISTORY_TOKEN_BUDGET);

    let mut parts: Vec<String> = Vec::new();
    if selected.len() < filtered.len() {
        parts.push(format!(
            "*({} earlier turns omitted)*",
            filtered.len() - selected.len()
        ));
    }

    for turn in &selected {
        let role = match turn.role {
            Role::User => "User",
            Role::Assistant => "Assistant",
        };
        let texts: Vec<&str> = turn
            .content
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect();
        if !texts.is_empty() {
            parts.push(format!("**{role}**: {}", texts.join("\n")));
        }

        if !turn.tool_calls.is_empty() {
            let summary = turn
                .tool_calls
                .iter()
                .map(|tc| {
                    let mut result_str = String::new();
                    if let Some(result) = &tc.result {
                        let raw = match result {
                            Value::String(s) => s.clone(),
                            other => other.to_string(),
                        };
                        result_str = if raw.chars().count() > TOOL_RESULT_MAX_CHARS {
                            let truncated: String =
                                raw.chars().take(TOOL_RESULT_MAX_CHARS).collect();
                            format!(" → {truncated}...(truncated)")
                        } else {
                            format!(" → {raw}")
                        };
                    }
                    format!("  - {}{result_str}", tc.tool_name)
                })
                .collect::<Vec<_>>()
                .join("\n");
            parts.push(format!("**{role} (tools)**:\n{summary}"));
        }
    }

    parts.join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry(update: Value) -> Value {
        json!({
            "type": "notification",
            "timestamp": "2026-01-01T00:00:00.000Z",
            "notification": {
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": { "update": update },
            }
        })
    }

    #[test]
    fn rebuilds_turns_with_tools_and_merged_text() {
        let entries = vec![
            entry(
                json!({ "sessionUpdate": "user_message", "content": { "type": "text", "text": "Fix the bug" } }),
            ),
            entry(
                json!({ "sessionUpdate": "agent_message", "content": { "type": "text", "text": "Looking. " } }),
            ),
            entry(
                json!({ "sessionUpdate": "agent_message", "content": { "type": "text", "text": "Found it." } }),
            ),
            entry(json!({
                "sessionUpdate": "tool_call",
                "_meta": { "claudeCode": { "toolCallId": "t1", "toolName": "Read", "toolInput": { "path": "a.rs" } } },
            })),
            entry(json!({
                "sessionUpdate": "tool_call_update",
                "_meta": { "claudeCode": { "toolCallId": "t1", "toolName": "Read", "toolResponse": "contents" } },
            })),
            entry(
                json!({ "sessionUpdate": "user_message", "content": [{ "type": "text", "text": "thanks" }] }),
            ),
        ];
        let turns = rebuild_conversation(&entries);
        assert_eq!(turns.len(), 3);
        assert_eq!(turns[0].role, Role::User);
        assert_eq!(turns[1].role, Role::Assistant);
        assert_eq!(turn_text(&turns[1]), "Looking. Found it.");
        assert_eq!(turns[1].tool_calls.len(), 1);
        assert_eq!(turns[1].tool_calls[0].result, Some(json!("contents")));
        assert_eq!(turns[2].role, Role::User);
    }

    #[test]
    fn finds_checkpoint_session_id_scanning_backwards() {
        let entries = vec![
            json!({ "notification": { "method": "_posthog/run_started", "params": { "sessionId": "s1" } } }),
            json!({ "notification": { "method": "_posthog/git_checkpoint", "params": { "checkpointId": "c1", "checkpointRef": "refs/x" } } }),
            json!({ "notification": { "method": "_posthog/run_started", "params": { "sessionId": "s2" } } }),
            // Invalid checkpoint (missing ref) must be skipped.
            json!({ "notification": { "method": "_posthog/git_checkpoint", "params": { "checkpointId": "c2" } } }),
        ];
        assert_eq!(find_session_id(&entries), Some("s2".to_string()));
        let checkpoint = find_latest_git_checkpoint(&entries).unwrap();
        assert_eq!(checkpoint["checkpointId"], "c1");
    }

    #[test]
    fn formats_with_budget_and_truncation() {
        let turns = vec![
            ConversationTurn {
                role: Role::User,
                content: vec![json!({ "type": "text", "text": "Do the thing" })],
                tool_calls: Vec::new(),
            },
            ConversationTurn {
                role: Role::Assistant,
                content: vec![json!({ "type": "text", "text": "Done" })],
                tool_calls: vec![ToolCallInfo {
                    tool_call_id: "t1".to_string(),
                    tool_name: "Bash".to_string(),
                    input: Some(json!({"command": "ls"})),
                    result: Some(json!("x".repeat(3000))),
                }],
            },
        ];
        let formatted = format_conversation_for_resume(&turns);
        assert!(formatted.contains("**User**: Do the thing"));
        assert!(formatted.contains("**Assistant**: Done"));
        assert!(formatted.contains("...(truncated)"));
        assert!(!formatted.contains(&"x".repeat(2500)));
    }

    #[test]
    fn resume_context_turns_are_filtered() {
        let turns = vec![
            ConversationTurn {
                role: Role::User,
                content: vec![
                    json!({ "type": "text", "text": "You are resuming a previous conversation. blah" }),
                ],
                tool_calls: Vec::new(),
            },
            ConversationTurn {
                role: Role::User,
                content: vec![json!({ "type": "text", "text": "real ask" })],
                tool_calls: Vec::new(),
            },
        ];
        let formatted = format_conversation_for_resume(&turns);
        assert!(!formatted.contains("You are resuming"));
        assert!(formatted.contains("real ask"));
    }
}
