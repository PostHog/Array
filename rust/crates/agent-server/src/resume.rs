//! Session resume from the persisted run log.
//!
//! Port of `resume.ts` + `sagas/resume-saga.ts` (the summary path) plus the
//! native-resume half of `adapters/claude/session/jsonl-hydration.ts` and
//! `adapters/codex-app-server/thread-state.ts`: fetch the prior run's log,
//! rebuild the conversation from `session/update` notifications, and either
//! hydrate a Claude session JSONL / detect codex thread state for a native
//! `session/resume`, or format a token-budgeted summary for the fallback
//! resume prompt.

use std::path::PathBuf;

use serde_json::{json, Value};

use posthog_agent_tools::session_jsonl;

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
            // ACP puts toolCallId/rawInput/rawOutput on the update itself;
            // `_meta.claudeCode` only reliably carries toolName (and sometimes
            // toolInput/toolResponse in older sidecar logs).
            Some("tool_call") | Some("tool_call_update") => {
                let meta = update.pointer("/_meta/claudeCode");
                let meta_str = |key: &str| meta.and_then(|m| m.get(key)).and_then(Value::as_str);
                let Some(tool_call_id) = update
                    .get("toolCallId")
                    .and_then(Value::as_str)
                    .or_else(|| meta_str("toolCallId"))
                    .map(str::to_string)
                else {
                    continue;
                };
                let existing = tool_calls
                    .iter_mut()
                    .find(|tc| tc.tool_call_id == tool_call_id);
                let tool_call = match existing {
                    Some(tc) => tc,
                    None => {
                        // Bare streaming updates carry no name; the opening
                        // tool_call always does, so the call exists by the
                        // time they arrive.
                        let Some(tool_name) = meta_str("toolName") else {
                            continue;
                        };
                        tool_calls.push(ToolCallInfo {
                            tool_call_id,
                            tool_name: tool_name.to_string(),
                            input: None,
                            result: None,
                        });
                        tool_calls.last_mut().expect("just pushed")
                    }
                };
                let input = update
                    .get("rawInput")
                    .or_else(|| meta.and_then(|m| m.get("toolInput")));
                if let Some(input) = input {
                    // The opening tool_call ships rawInput: {} — don't clobber
                    // an already-streamed input with it.
                    let empty_record = input.as_object().map(|o| o.is_empty()).unwrap_or(false);
                    if !(empty_record && tool_call.input.is_some()) {
                        tool_call.input = Some(input.clone());
                    }
                }
                let result = update
                    .get("rawOutput")
                    .or_else(|| meta.and_then(|m| m.get("toolResponse")));
                if let Some(result) = result {
                    tool_call.result = Some(result.clone());
                }
            }
            Some("tool_result") => {
                let meta = update.pointer("/_meta/claudeCode");
                let Some(tool_call_id) =
                    update
                        .get("toolCallId")
                        .and_then(Value::as_str)
                        .or_else(|| {
                            meta.and_then(|m| m.get("toolCallId"))
                                .and_then(Value::as_str)
                        })
                else {
                    continue;
                };
                let result = update
                    .get("rawOutput")
                    .or_else(|| meta.and_then(|m| m.get("toolResponse")));
                if let Some(result) = result {
                    if let Some(tc) = tool_calls
                        .iter_mut()
                        .find(|tc| tc.tool_call_id == tool_call_id)
                    {
                        tc.result = Some(result.clone());
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

// ---------------------------------------------------------------------------
// Native resume: Claude session JSONL hydration (jsonl-hydration.ts) and
// codex thread-state detection (thread-state.ts)

/// `DEFAULT_GATEWAY_MODEL` (gateway-models.ts): stamped into hydrated JSONL
/// entries when the run has no explicit model.
const DEFAULT_GATEWAY_MODEL: &str = "claude-opus-4-8";
/// Claude Code version stamped into hydrated entries (jsonl-hydration.ts).
const JSONL_VERSION: &str = "2.1.63";
const HYDRATION_MAX_TOKENS: usize = 150_000;
const HYDRATION_LARGE_CONTEXT_MAX_TOKENS: usize = 800_000;
/// Individual tool payloads can be huge (whole-file Write inputs, full test
/// output). Cap each one so a single call can't dominate the resume budget.
const MAX_TOOL_PAYLOAD_CHARS: usize = 10_000;

/// `supports1MContext` (models.ts) — models resumed with the large budget.
pub fn supports_1m_context(model_id: &str) -> bool {
    matches!(
        model_id,
        "claude-opus-4-7"
            | "claude-opus-4-8"
            | "claude-sonnet-4-6"
            | "claude-sonnet-5"
            | "claude-fable-5"
    )
}

fn floor_char_boundary(s: &str, index: usize) -> usize {
    let mut index = index.min(s.len());
    while index > 0 && !s.is_char_boundary(index) {
        index -= 1;
    }
    index
}

/// `capToolPayload`: truncate oversized payloads, wrapping objects (tool_use
/// input must stay an object per the Claude API schema).
fn cap_tool_payload(value: &Value) -> Value {
    let text = match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    if text.len() <= MAX_TOOL_PAYLOAD_CHARS {
        return value.clone();
    }
    let cut = floor_char_boundary(&text, MAX_TOOL_PAYLOAD_CHARS);
    let preview = format!("{}… [truncated {} chars]", &text[..cut], text.len() - cut);
    match value {
        Value::String(_) => Value::String(preview),
        _ => json!({ "_truncated": true, "preview": preview, "originalSize": text.len() }),
    }
}

fn random_bytes(count: usize) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(count);
    while bytes.len() < count {
        bytes.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    }
    bytes.truncate(count);
    bytes
}

/// Anthropic-shaped message id: `msg_01` + 24 base62 chars.
fn generate_message_id() -> String {
    const BASE62: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut id = String::from("msg_01");
    for byte in random_bytes(24) {
        id.push(BASE62[(byte % 62) as usize] as char);
    }
    id
}

fn generate_slug() -> String {
    const ADJECTIVES: [&str; 16] = [
        "bright", "calm", "daring", "eager", "fair", "gentle", "happy", "keen", "lively", "merry",
        "noble", "polite", "quick", "sharp", "warm", "witty",
    ];
    const VERBS: [&str; 16] = [
        "blazing", "crafting", "dashing", "flowing", "gliding", "humming", "jumping", "linking",
        "melting", "nesting", "pacing", "roaming", "sailing", "turning", "waving", "zoning",
    ];
    const NOUNS: [&str; 16] = [
        "aurora", "breeze", "cedar", "delta", "ember", "frost", "grove", "haven", "inlet", "jewel",
        "knoll", "lotus", "maple", "nexus", "oasis", "prism",
    ];
    let picks = random_bytes(3);
    format!(
        "{}-{}-{}",
        ADJECTIVES[(picks[0] % 16) as usize],
        VERBS[(picks[1] % 16) as usize],
        NOUNS[(picks[2] % 16) as usize]
    )
}

pub struct JsonlConfig<'a> {
    pub session_id: &'a str,
    pub cwd: &'a str,
    pub model: Option<&'a str>,
    pub permission_mode: &'a str,
}

/// `conversationTurnsToJsonlEntries`: render the rebuilt conversation as the
/// Claude CLI's session-JSONL format so `--resume <sessionId>` picks it up as
/// native history.
pub fn conversation_turns_to_jsonl_entries(
    turns: &[ConversationTurn],
    config: &JsonlConfig,
) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let mut parent_uuid = Value::Null;
    let model = config.model.unwrap_or(DEFAULT_GATEWAY_MODEL);
    let slug = generate_slug();
    let base_time =
        chrono::Utc::now() - chrono::Duration::milliseconds((turns.len() * 3000) as i64);

    for (turn_index, turn) in turns.iter().enumerate() {
        let timestamp = (base_time + chrono::Duration::milliseconds((turn_index * 3000) as i64))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let envelope = |parent: &Value, uuid: &str, kind: &str, message: Value| {
            json!({
                "parentUuid": parent,
                "isSidechain": false,
                "userType": "external",
                "cwd": config.cwd,
                "sessionId": config.session_id,
                "version": JSONL_VERSION,
                "gitBranch": "",
                "slug": slug,
                "type": kind,
                "message": message,
                "uuid": uuid,
                "timestamp": timestamp,
            })
        };

        match turn.role {
            Role::User => {
                for operation in ["enqueue", "dequeue"] {
                    lines.push(
                        json!({
                            "type": "queue-operation",
                            "operation": operation,
                            "timestamp": timestamp,
                            "sessionId": config.session_id,
                        })
                        .to_string(),
                    );
                }

                let text_parts: Vec<&str> = turn
                    .content
                    .iter()
                    .filter_map(|b| b.get("text").and_then(Value::as_str))
                    .filter(|t| !t.is_empty())
                    .collect();
                let user_text = if text_parts.is_empty() {
                    " ".to_string()
                } else {
                    text_parts.join("")
                };

                let uuid = uuid::Uuid::new_v4().to_string();
                let mut line = envelope(
                    &parent_uuid,
                    &uuid,
                    "user",
                    json!({
                        "role": "user",
                        "content": [{ "type": "text", "text": user_text }],
                    }),
                );
                line["permissionMode"] = json!(config.permission_mode);
                lines.push(line.to_string());
                parent_uuid = json!(uuid);
            }
            Role::Assistant => {
                let mut blocks: Vec<Value> = turn
                    .content
                    .iter()
                    .filter(|b| {
                        matches!(
                            b.get("type").and_then(Value::as_str),
                            Some("text") | Some("thinking")
                        ) && !session_jsonl::is_empty_content_block(b)
                    })
                    .cloned()
                    .collect();
                for tc in &turn.tool_calls {
                    let mut block = json!({
                        "type": "tool_use",
                        "id": tc.tool_call_id,
                        "name": tc.tool_name,
                    });
                    if let Some(input) = &tc.input {
                        block["input"] = cap_tool_payload(input);
                    }
                    blocks.push(block);
                }

                let msg_id = generate_message_id();
                let has_tool_use = !turn.tool_calls.is_empty();
                let last_stop_reason = if has_tool_use { "tool_use" } else { "end_turn" };
                let block_count = blocks.len();
                for (i, block) in blocks.into_iter().enumerate() {
                    let uuid = uuid::Uuid::new_v4().to_string();
                    let stop_reason = if i + 1 == block_count {
                        json!(last_stop_reason)
                    } else {
                        Value::Null
                    };
                    lines.push(
                        envelope(
                            &parent_uuid,
                            &uuid,
                            "assistant",
                            json!({
                                "model": model,
                                "id": msg_id,
                                "type": "message",
                                "role": "assistant",
                                "content": [block],
                                "stop_reason": stop_reason,
                                "stop_sequence": null,
                                "usage": {
                                    "input_tokens": 0,
                                    "cache_creation_input_tokens": 0,
                                    "cache_read_input_tokens": 0,
                                    "output_tokens": 0,
                                },
                            }),
                        )
                        .to_string(),
                    );
                    parent_uuid = json!(uuid);
                }

                for tc in &turn.tool_calls {
                    let Some(result) = &tc.result else { continue };
                    let result_text = match cap_tool_payload(result) {
                        Value::String(s) => s,
                        other => other.to_string(),
                    };
                    let uuid = uuid::Uuid::new_v4().to_string();
                    lines.push(
                        envelope(
                            &parent_uuid,
                            &uuid,
                            "user",
                            json!({
                                "role": "user",
                                "content": [{
                                    "type": "tool_result",
                                    "tool_use_id": tc.tool_call_id,
                                    "content": result_text,
                                }],
                            }),
                        )
                        .to_string(),
                    );
                    parent_uuid = json!(uuid);
                }
            }
        }
    }

    lines
}

pub struct HydrationConfig<'a> {
    pub session_id: &'a str,
    pub cwd: &'a str,
    pub model: Option<&'a str>,
    pub permission_mode: &'a str,
}

/// `hydrateSessionJsonl`: make sure the prior session's JSONL exists so the
/// Claude CLI can `--resume` natively — a pre-existing file (warm sandbox) is
/// sanitized and kept; otherwise the file is rebuilt from the resume-state
/// conversation. Returns whether a session file is in place.
pub fn hydrate_session_jsonl(conversation: &[ConversationTurn], cfg: &HydrationConfig) -> bool {
    let jsonl_path = session_jsonl::get_session_jsonl_path(cfg.session_id, cfg.cwd);
    if jsonl_path.exists() {
        // A sanitize failure must not block resuming from the existing file.
        match session_jsonl::sanitize_session_jsonl(&jsonl_path) {
            Ok(true) => tracing::debug!(
                path = %jsonl_path.display(),
                "Removed empty content blocks from existing session JSONL"
            ),
            Ok(false) => {}
            Err(err) => tracing::warn!(
                error = %err,
                path = %jsonl_path.display(),
                "Failed to sanitize existing session JSONL"
            ),
        }
        return true;
    }

    if conversation.is_empty() {
        tracing::debug!("No conversation to hydrate, skipping JSONL hydration");
        return false;
    }

    let max_tokens = if cfg.model.map(supports_1m_context).unwrap_or(false) {
        HYDRATION_LARGE_CONTEXT_MAX_TOKENS
    } else {
        HYDRATION_MAX_TOKENS
    };
    let selected = select_recent_turns(conversation, max_tokens);
    tracing::debug!(
        total_turns = conversation.len(),
        selected_turns = selected.len(),
        "Selected recent turns for hydration"
    );

    let lines = conversation_turns_to_jsonl_entries(
        &selected,
        &JsonlConfig {
            session_id: cfg.session_id,
            cwd: cfg.cwd,
            model: cfg.model,
            permission_mode: cfg.permission_mode,
        },
    );

    let write = || -> std::io::Result<()> {
        if let Some(parent) = jsonl_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp_path = jsonl_path.with_extension(format!("tmp.{}", std::process::id()));
        std::fs::write(&tmp_path, format!("{}\n", lines.join("\n")))?;
        std::fs::rename(&tmp_path, &jsonl_path)?;
        Ok(())
    };
    match write() {
        Ok(()) => {
            tracing::debug!(
                session_id = cfg.session_id,
                turns = selected.len(),
                lines = lines.len(),
                "Hydrated session JSONL from the prior run log"
            );
            true
        }
        Err(err) => {
            tracing::warn!(
                error = %err,
                session_id = cfg.session_id,
                "Failed to hydrate session JSONL, continuing"
            );
            false
        }
    }
}

/// `hasCodexThreadState`: whether codex persisted a rollout for this thread
/// under `CODEX_HOME/sessions` (`rollout-*-<threadId>.jsonl`, nested by
/// date). Only a snapshot-restored sandbox has one — there is no cold
/// hydration equivalent for codex.
pub fn has_codex_thread_state(thread_id: &str) -> bool {
    if thread_id.is_empty() {
        return false;
    }
    let codex_home = std::env::var("CODEX_HOME")
        .ok()
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
            PathBuf::from(home).join(".codex")
        });
    let suffix = format!("-{thread_id}.jsonl");
    let mut stack = vec![codex_home.join("sessions")];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with("rollout-") && name.ends_with(&suffix) {
                    return true;
                }
            }
        }
    }
    false
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

    #[test]
    fn rebuild_reads_top_level_tool_fields() {
        // The Rust driver puts toolCallId/rawInput/rawOutput on the update
        // itself, with only toolName under _meta.claudeCode.
        let entries = vec![
            entry(json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "toolu_1",
                "rawInput": {},
                "_meta": { "claudeCode": { "toolName": "Bash" } },
            })),
            entry(json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": "toolu_1",
                "rawInput": { "command": "echo hi" },
            })),
            entry(json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": "toolu_1",
                "rawInput": {},
                "rawOutput": { "stdout": "hi" },
            })),
        ];
        let turns = rebuild_conversation(&entries);
        assert_eq!(turns.len(), 1);
        let tc = &turns[0].tool_calls[0];
        assert_eq!(tc.tool_name, "Bash");
        // The opening {} must not clobber the streamed input.
        assert_eq!(tc.input, Some(json!({ "command": "echo hi" })));
        assert_eq!(tc.result, Some(json!({ "stdout": "hi" })));
    }

    fn hydration_turns() -> Vec<ConversationTurn> {
        vec![
            ConversationTurn {
                role: Role::User,
                content: vec![json!({ "type": "text", "text": "Fix the bug" })],
                tool_calls: Vec::new(),
            },
            ConversationTurn {
                role: Role::Assistant,
                content: vec![
                    json!({ "type": "text", "text": "Looking" }),
                    json!({ "type": "text", "text": "" }),
                ],
                tool_calls: vec![ToolCallInfo {
                    tool_call_id: "toolu_1".into(),
                    tool_name: "Read".into(),
                    input: Some(json!({ "file_path": "/tmp/a" })),
                    result: Some(json!("contents")),
                }],
            },
        ]
    }

    #[test]
    fn jsonl_entries_match_the_claude_session_format() {
        let lines = conversation_turns_to_jsonl_entries(
            &hydration_turns(),
            &JsonlConfig {
                session_id: "sess-1",
                cwd: "/tmp/repo",
                model: None,
                permission_mode: "default",
            },
        );
        let parsed: Vec<Value> = lines
            .iter()
            .map(|l| serde_json::from_str(l).expect("valid json"))
            .collect();

        // queue enqueue/dequeue, user, assistant text, assistant tool_use,
        // tool_result.
        assert_eq!(parsed.len(), 6);
        assert_eq!(parsed[0]["type"], "queue-operation");
        assert_eq!(parsed[0]["operation"], "enqueue");
        assert_eq!(parsed[1]["operation"], "dequeue");

        let user = &parsed[2];
        assert_eq!(user["type"], "user");
        assert_eq!(user["permissionMode"], "default");
        assert_eq!(user["message"]["content"][0]["text"], "Fix the bug");
        assert_eq!(user["parentUuid"], Value::Null);

        let text = &parsed[3];
        assert_eq!(text["type"], "assistant");
        assert_eq!(text["message"]["model"], "claude-opus-4-8");
        assert_eq!(text["message"]["stop_reason"], Value::Null);
        assert_eq!(text["parentUuid"], user["uuid"]);

        let tool_use = &parsed[4];
        assert_eq!(tool_use["message"]["content"][0]["type"], "tool_use");
        assert_eq!(tool_use["message"]["content"][0]["name"], "Read");
        // Last block of a tool-using turn stops with tool_use.
        assert_eq!(tool_use["message"]["stop_reason"], "tool_use");
        // Same Anthropic message id across the turn's blocks.
        assert_eq!(tool_use["message"]["id"], text["message"]["id"]);

        let result = &parsed[5];
        assert_eq!(result["type"], "user");
        assert_eq!(result["message"]["content"][0]["type"], "tool_result");
        assert_eq!(result["message"]["content"][0]["tool_use_id"], "toolu_1");
        assert_eq!(result["message"]["content"][0]["content"], "contents");
    }

    #[test]
    fn oversized_tool_payloads_are_capped_in_jsonl() {
        let mut turns = hydration_turns();
        turns[1].tool_calls[0].result = Some(json!("x".repeat(20_000)));
        let lines = conversation_turns_to_jsonl_entries(
            &turns,
            &JsonlConfig {
                session_id: "s",
                cwd: "/tmp",
                model: None,
                permission_mode: "default",
            },
        );
        let result: Value = serde_json::from_str(lines.last().expect("result line")).unwrap();
        let content = result["message"]["content"][0]["content"]
            .as_str()
            .expect("string result");
        assert!(content.len() < 11_000);
        assert!(content.contains("[truncated 10000 chars]"));
    }

    #[test]
    fn hydrate_writes_file_and_prefers_existing() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::env::set_var("CLAUDE_CONFIG_DIR", dir.path());

        let cfg = HydrationConfig {
            session_id: "sess-hydrate",
            cwd: "/tmp/repo",
            model: Some("claude-fable-5"),
            permission_mode: "default",
        };
        assert!(!hydrate_session_jsonl(&[], &cfg));
        assert!(hydrate_session_jsonl(&hydration_turns(), &cfg));

        let path =
            posthog_agent_tools::session_jsonl::get_session_jsonl_path("sess-hydrate", "/tmp/repo");
        let written = std::fs::read_to_string(&path).expect("hydrated file");
        assert!(written.contains("Fix the bug"));

        // Existing file wins: hydrating again with an empty conversation
        // still reports a session (the warm path).
        assert!(hydrate_session_jsonl(&[], &cfg));
        std::env::remove_var("CLAUDE_CONFIG_DIR");
    }

    #[test]
    fn codex_thread_state_is_detected_recursively() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::env::set_var("CODEX_HOME", dir.path());
        assert!(!has_codex_thread_state("thread-1"));

        let day_dir = dir.path().join("sessions/2026/07/09");
        std::fs::create_dir_all(&day_dir).expect("mkdir");
        std::fs::write(
            day_dir.join("rollout-2026-07-09T10-00-00-thread-1.jsonl"),
            "{}",
        )
        .expect("write rollout");

        assert!(has_codex_thread_state("thread-1"));
        assert!(!has_codex_thread_state("thread-2"));
        assert!(!has_codex_thread_state(""));
        std::env::remove_var("CODEX_HOME");
    }
}
