//! SDK message → ACP session-update conversion.
//!
//! Port of `adapters/claude/conversion/sdk-to-acp.ts` and
//! `tool-use-to-acp.ts` (the cloud-relevant subset). With
//! `--include-partial-messages` the CLI streams text/thinking deltas and
//! tool_use starts live; the consolidated assistant message then re-emits
//! tool_use blocks (refined to `tool_call_update` with the final input) and
//! its text/thinking blocks are dropped as already-streamed. Task* tools are
//! suppressed in favour of ACP `plan` updates rebuilt from their results.

use std::collections::HashMap;

use serde_json::{json, Map, Value};

/// One outgoing ACP-side effect of converting a CLI message.
#[derive(Debug, Clone)]
pub enum Outgoing {
    /// `session/update` notification payload (the `update` object).
    Update(Value),
    /// Extension notification `(method, params)`.
    Ext(&'static str, Value),
}

/// Terminal outcome of a turn, from the `result` message.
/// Mirror of `handleResultMessage` in sdk-to-acp.ts.
#[derive(Debug, Clone)]
pub struct TurnOutcome {
    /// ACP stopReason when the turn ended cleanly.
    pub stop_reason: Option<String>,
    /// Error message + classification-bearing data when it didn't.
    pub error: Option<(String, Value)>,
    pub usage: Option<Value>,
}

#[derive(Debug, Clone)]
struct CachedToolUse {
    name: String,
    input: Value,
}

#[derive(Debug, Clone, Default)]
struct TaskEntry {
    subject: String,
    status: String,
}

/// Per-session conversion state (mirror of ToolUseCache + emittedToolCalls +
/// TaskState in the TS adapter).
#[derive(Default)]
pub struct Converter {
    tool_use_cache: HashMap<String, CachedToolUse>,
    emitted_tool_calls: std::collections::HashSet<String>,
    /// Task id → entry, insertion-ordered via the companion vec.
    task_state: HashMap<String, TaskEntry>,
    task_order: Vec<String>,
    pub cwd: String,
}

impl Converter {
    pub fn new(cwd: &str) -> Self {
        Self {
            cwd: cwd.to_string(),
            ..Default::default()
        }
    }

    /// Convert one SDK message into ACP effects. `result` messages are
    /// handled separately via [`convert_result`].
    pub fn convert(&mut self, message: &Value) -> Vec<Outgoing> {
        match message.get("type").and_then(Value::as_str) {
            Some("stream_event") => self.convert_stream_event(message),
            Some("assistant") => self.convert_assistant(message),
            Some("user") => self.convert_user(message),
            Some("system") => self.convert_system(message),
            _ => Vec::new(),
        }
    }

    fn parent_tool_call_id(message: &Value) -> Option<String> {
        message
            .get("parent_tool_use_id")
            .and_then(Value::as_str)
            .map(str::to_string)
    }

    fn convert_stream_event(&mut self, message: &Value) -> Vec<Outgoing> {
        let parent = Self::parent_tool_call_id(message);
        let Some(event) = message.get("event") else {
            return Vec::new();
        };
        match event.get("type").and_then(Value::as_str) {
            Some("content_block_start") => {
                let Some(block) = event.get("content_block") else {
                    return Vec::new();
                };
                self.convert_content_block(block, "assistant", parent.as_deref())
            }
            Some("content_block_delta") => {
                let Some(delta) = event.get("delta") else {
                    return Vec::new();
                };
                self.convert_content_block(delta, "assistant", parent.as_deref())
            }
            _ => Vec::new(),
        }
    }

    fn convert_assistant(&mut self, message: &Value) -> Vec<Outgoing> {
        let parent = Self::parent_tool_call_id(message);
        let Some(content) = message.pointer("/message/content") else {
            return Vec::new();
        };
        let mut out = Vec::new();
        if let Some(blocks) = content.as_array() {
            for block in blocks {
                match block.get("type").and_then(Value::as_str) {
                    // Streamed live via content_block deltas; the consolidated
                    // copy would duplicate them (the TS "drop-all" filter).
                    Some("text") | Some("thinking") if parent.is_none() => {}
                    _ => out.extend(self.convert_content_block(
                        block,
                        "assistant",
                        parent.as_deref(),
                    )),
                }
            }
        }
        out
    }

    fn convert_user(&mut self, message: &Value) -> Vec<Outgoing> {
        let parent = Self::parent_tool_call_id(message);
        let mcp_tool_use_result = message.get("tool_use_result").cloned();
        let Some(content) = message.pointer("/message/content") else {
            return Vec::new();
        };
        let mut out = Vec::new();
        if let Some(blocks) = content.as_array() {
            for block in blocks {
                // Only tool_result blocks convert here; replayed user prompt
                // text was already broadcast as user_message_chunk at prompt
                // time.
                if block.get("type").and_then(Value::as_str) == Some("tool_result") {
                    out.extend(self.convert_tool_result(
                        block,
                        parent.as_deref(),
                        mcp_tool_use_result.as_ref(),
                    ));
                }
            }
        }
        out
    }

    fn convert_system(&mut self, message: &Value) -> Vec<Outgoing> {
        match message.get("subtype").and_then(Value::as_str) {
            Some("compact_boundary") => vec![Outgoing::Ext(
                "_posthog/compact_boundary",
                json!({
                    "trigger": message.pointer("/compact_metadata/trigger"),
                    "preTokens": message.pointer("/compact_metadata/pre_tokens"),
                }),
            )],
            Some("status")
                if message.get("status").and_then(Value::as_str) == Some("compacting") =>
            {
                vec![Outgoing::Ext(
                    "_posthog/status",
                    json!({ "status": "compacting" }),
                )]
            }
            Some("informational") => {
                let level = message
                    .get("level")
                    .and_then(Value::as_str)
                    .unwrap_or("info");
                let content = message
                    .get("content")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let text = if level == "info" {
                    content.to_string()
                } else {
                    let mut chars = level.chars();
                    let capitalized = match chars.next() {
                        Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                        None => String::new(),
                    };
                    format!("**{capitalized}:** {content}")
                };
                vec![Outgoing::Update(json!({
                    "sessionUpdate": "agent_message_chunk",
                    "content": { "type": "text", "text": text },
                }))]
            }
            Some("permission_denied") => {
                let reason = message
                    .get("decision_reason")
                    .and_then(Value::as_str)
                    .or_else(|| message.get("message").and_then(Value::as_str))
                    .unwrap_or("denied");
                vec![Outgoing::Update(json!({
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": message.get("tool_use_id"),
                    "status": "failed",
                    "content": [{
                        "type": "content",
                        "content": { "type": "text", "text": format!("Permission denied: {reason}") },
                    }],
                    "_meta": { "claudeCode": { "toolName": message.get("tool_name") } },
                }))]
            }
            _ => Vec::new(),
        }
    }

    fn convert_content_block(
        &mut self,
        block: &Value,
        role: &str,
        parent: Option<&str>,
    ) -> Vec<Outgoing> {
        match block.get("type").and_then(Value::as_str) {
            Some("text") | Some("text_delta") => {
                let text = block
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if text.is_empty() {
                    return Vec::new();
                }
                let update_type = if role == "assistant" {
                    "agent_message_chunk"
                } else {
                    "user_message_chunk"
                };
                let mut update = json!({
                    "sessionUpdate": update_type,
                    "content": { "type": "text", "text": text },
                });
                if let Some(parent) = parent {
                    update["_meta"] = tool_meta("__text__", None, Some(parent), None);
                }
                vec![Outgoing::Update(update)]
            }
            Some("thinking") | Some("thinking_delta") => {
                let text = block
                    .get("thinking")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                // Signature-only thinking blocks stream empty text.
                if text.is_empty() {
                    return Vec::new();
                }
                let mut update = json!({
                    "sessionUpdate": "agent_thought_chunk",
                    "content": { "type": "text", "text": text },
                });
                if let Some(parent) = parent {
                    update["_meta"] = tool_meta("__thinking__", None, Some(parent), None);
                }
                vec![Outgoing::Update(update)]
            }
            Some("tool_use") | Some("server_tool_use") | Some("mcp_tool_use") => {
                self.convert_tool_use(block, parent)
            }
            _ => Vec::new(),
        }
    }

    fn convert_tool_use(&mut self, block: &Value, parent: Option<&str>) -> Vec<Outgoing> {
        let Some(id) = block.get("id").and_then(Value::as_str).map(str::to_string) else {
            return Vec::new();
        };
        let name = block
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Other")
            .to_string();
        let input = block.get("input").cloned().unwrap_or(json!({}));

        let already_emitted = self.emitted_tool_calls.contains(&id);
        self.tool_use_cache.insert(
            id.clone(),
            CachedToolUse {
                name: name.clone(),
                input: input.clone(),
            },
        );

        // Task* tool_calls are suppressed; plan updates come from results.
        if matches!(
            name.as_str(),
            "TaskCreate" | "TaskUpdate" | "TaskList" | "TaskGet"
        ) {
            return Vec::new();
        }
        self.emitted_tool_calls.insert(id.clone());

        let bash_command = bash_command_for(&name, &input);
        let info = tool_info(&name, &input, &self.cwd);
        let meta = tool_meta(&name, None, parent, bash_command.as_deref());

        let mut update = json!({
            "_meta": meta,
            "toolCallId": id,
            "rawInput": input,
            "title": info.title,
            "kind": info.kind,
            "content": info.content,
        });
        if let Some(locations) = info.locations {
            update["locations"] = locations;
        }
        if already_emitted {
            update["sessionUpdate"] = json!("tool_call_update");
        } else {
            update["sessionUpdate"] = json!("tool_call");
            update["status"] = json!("pending");
        }
        vec![Outgoing::Update(update)]
    }

    fn convert_tool_result(
        &mut self,
        block: &Value,
        parent: Option<&str>,
        mcp_tool_use_result: Option<&Value>,
    ) -> Vec<Outgoing> {
        let Some(tool_use_id) = block.get("tool_use_id").and_then(Value::as_str) else {
            return Vec::new();
        };
        let Some(tool_use) = self.tool_use_cache.remove(tool_use_id) else {
            tracing::debug!(tool_use_id, "Tool result for untracked tool use");
            return Vec::new();
        };
        self.emitted_tool_calls.remove(tool_use_id);

        let is_error = block
            .get("is_error")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let content = block.get("content").cloned().unwrap_or(Value::Null);

        // Task* results feed the plan instead of surfacing tool calls.
        if matches!(
            tool_use.name.as_str(),
            "TaskCreate" | "TaskUpdate" | "TaskList" | "TaskGet"
        ) {
            if is_error {
                return Vec::new();
            }
            return self.apply_task_tool(&tool_use, &content);
        }

        let raw_output = match mcp_tool_use_result {
            Some(mcp) if mcp.is_object() => {
                let mut merged = mcp.as_object().cloned().unwrap_or_default();
                merged.insert("isError".into(), json!(is_error));
                Value::Object(merged)
            }
            _ => json!({
                "content": normalize_result_content(&content),
                "isError": is_error,
            }),
        };

        let bash_command = bash_command_for(&tool_use.name, &tool_use.input);
        let mut update = json!({
            "_meta": tool_meta(&tool_use.name, None, parent, bash_command.as_deref()),
            "toolCallId": tool_use_id,
            "sessionUpdate": "tool_call_update",
            "status": if is_error { "failed" } else { "completed" },
            "rawOutput": raw_output,
        });

        // Result text as displayable content for read-style tools (the TS
        // toAcpContentUpdate subset: plain text out of the result blocks).
        if let Some(text) = result_text(&content) {
            if !text.is_empty() && !matches!(tool_use.name.as_str(), "Edit" | "Write" | "Read") {
                update["content"] = json!([{
                    "type": "content",
                    "content": { "type": "text", "text": text },
                }]);
            }
        }

        vec![Outgoing::Update(update)]
    }

    fn apply_task_tool(
        &mut self,
        tool_use: &CachedToolUse,
        result_content: &Value,
    ) -> Vec<Outgoing> {
        match tool_use.name.as_str() {
            "TaskCreate" => {
                let subject = tool_use
                    .input
                    .get("subject")
                    .and_then(Value::as_str)
                    .unwrap_or("Task")
                    .to_string();
                // The result text carries "Task #<id> created…"; fall back to a
                // synthetic id keyed by insertion order.
                let id = result_text(result_content)
                    .and_then(|t| {
                        t.split('#').nth(1).and_then(|rest| {
                            rest.split_whitespace()
                                .next()
                                .map(|id| id.trim_end_matches(':').to_string())
                        })
                    })
                    .unwrap_or_else(|| format!("task-{}", self.task_order.len() + 1));
                if !self.task_state.contains_key(&id) {
                    self.task_order.push(id.clone());
                }
                self.task_state.insert(
                    id,
                    TaskEntry {
                        subject,
                        status: "pending".into(),
                    },
                );
            }
            "TaskUpdate" => {
                let task_id = tool_use
                    .input
                    .get("taskId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let entry = self
                    .task_state
                    .entry(task_id.clone())
                    .or_insert_with(|| TaskEntry {
                        subject: format!("Task {task_id}"),
                        status: "pending".into(),
                    });
                if !self.task_order.contains(&task_id) {
                    self.task_order.push(task_id);
                }
                if let Some(subject) = tool_use.input.get("subject").and_then(Value::as_str) {
                    entry.subject = subject.to_string();
                }
                if let Some(status) = tool_use.input.get("status").and_then(Value::as_str) {
                    entry.status = match status {
                        "completed" => "completed".into(),
                        "in_progress" => "in_progress".into(),
                        "deleted" => return self.emit_task_deleted(),
                        other => other.to_string(),
                    };
                }
            }
            _ => return Vec::new(),
        }
        vec![self.plan_update()]
    }

    fn emit_task_deleted(&mut self) -> Vec<Outgoing> {
        vec![self.plan_update()]
    }

    fn plan_update(&self) -> Outgoing {
        let entries: Vec<Value> = self
            .task_order
            .iter()
            .filter_map(|id| self.task_state.get(id))
            .map(|task| {
                json!({
                    "content": task.subject,
                    "status": task.status,
                    "priority": "medium",
                })
            })
            .collect();
        Outgoing::Update(json!({ "sessionUpdate": "plan", "entries": entries }))
    }

    /// Hook-path task mutations (SDK TaskCreated/TaskCompleted hook events,
    /// the port of `createTaskHook`). These fire before the matching
    /// tool_result chunk arrives, so entries exist with a real subject by the
    /// time TaskUpdate (which only carries id + status) runs. Returns the
    /// plan update when state actually changed.
    pub fn apply_task_hook(
        &mut self,
        event: &str,
        task_id: &str,
        subject: Option<&str>,
    ) -> Option<Outgoing> {
        match event {
            "TaskCreated" => {
                let subject = subject?;
                // Re-entry guard: a duplicate TaskCreated must not clobber a
                // TaskUpdate that landed in between.
                if self.task_state.contains_key(task_id) {
                    return None;
                }
                self.task_order.push(task_id.to_string());
                self.task_state.insert(
                    task_id.to_string(),
                    TaskEntry {
                        subject: subject.to_string(),
                        status: "pending".into(),
                    },
                );
            }
            "TaskCompleted" => {
                let entry = self.task_state.get_mut(task_id)?;
                entry.status = "completed".into();
            }
            _ => return None,
        }
        Some(self.plan_update())
    }

    /// `rehydrateTaskState` (task-state.ts): rebuild the plan panel from a
    /// session-JSONL transcript by replaying TaskCreate/TaskUpdate tool
    /// inputs/outputs. Used on `session/resume` to recover the plan when the
    /// agent restarts mid-conversation. Returns the plan update to broadcast
    /// when any state was recovered.
    pub fn rehydrate_task_state(&mut self, messages: &[Value]) -> Option<Value> {
        let mut pending: HashMap<String, CachedToolUse> = HashMap::new();
        for msg in messages {
            let Some(content) = msg.pointer("/message/content").and_then(Value::as_array) else {
                continue;
            };
            match msg.get("type").and_then(Value::as_str) {
                Some("assistant") => {
                    for block in content {
                        if block.get("type").and_then(Value::as_str) != Some("tool_use") {
                            continue;
                        }
                        let (Some(id), Some(name)) = (
                            block.get("id").and_then(Value::as_str),
                            block.get("name").and_then(Value::as_str),
                        ) else {
                            continue;
                        };
                        if name == "TaskCreate" || name == "TaskUpdate" {
                            pending.insert(
                                id.to_string(),
                                CachedToolUse {
                                    name: name.to_string(),
                                    input: block.get("input").cloned().unwrap_or_else(|| json!({})),
                                },
                            );
                        }
                    }
                }
                Some("user") => {
                    for block in content {
                        if block.get("type").and_then(Value::as_str) != Some("tool_result") {
                            continue;
                        }
                        if block
                            .get("is_error")
                            .and_then(Value::as_bool)
                            .unwrap_or(false)
                        {
                            continue;
                        }
                        let Some(id) = block.get("tool_use_id").and_then(Value::as_str) else {
                            continue;
                        };
                        let Some(tool_use) = pending.remove(id) else {
                            continue;
                        };
                        let result_content = block.get("content").cloned().unwrap_or(Value::Null);
                        let _ = self.apply_task_tool(&tool_use, &result_content);
                    }
                }
                _ => {}
            }
        }
        if self.task_state.is_empty() {
            return None;
        }
        match self.plan_update() {
            Outgoing::Update(update) => Some(update),
            Outgoing::Ext(..) => None,
        }
    }

    /// The SDK can invoke canUseTool before the tool_use block streams; make
    /// sure the tool_call exists before the client is asked to approve it
    /// (`ensureToolCallEmitted`). Returns the pending tool_call when new.
    pub fn ensure_tool_call_emitted(
        &mut self,
        id: &str,
        name: &str,
        input: &Value,
    ) -> Option<Value> {
        if matches!(
            name,
            "TodoWrite" | "TaskCreate" | "TaskUpdate" | "TaskList" | "TaskGet"
        ) {
            return None;
        }
        if self.emitted_tool_calls.contains(id) {
            return None;
        }
        self.emitted_tool_calls.insert(id.to_string());
        self.tool_use_cache.insert(
            id.to_string(),
            CachedToolUse {
                name: name.to_string(),
                input: input.clone(),
            },
        );
        let info = tool_info(name, input, &self.cwd);
        let mut update = json!({
            "_meta": { "claudeCode": { "toolName": name } },
            "toolCallId": id,
            "sessionUpdate": "tool_call",
            "rawInput": input,
            "status": "pending",
            "title": info.title,
            "kind": info.kind,
            "content": info.content,
        });
        if let Some(locations) = info.locations {
            update["locations"] = locations;
        }
        Some(update)
    }
}

/// `toolUpdateFromEditToolResponse`: rebuild a rich diff from the Edit/Write
/// tool response's `structuredPatch`, for the PostToolUse update. Returns
/// `(content, locations)` when the response carries hunks.
pub fn tool_update_from_edit_response(tool_response: &Value) -> Option<(Value, Value)> {
    let patches = tool_response.get("structuredPatch")?.as_array()?;
    if patches.is_empty() {
        return None;
    }

    let mut content: Vec<Value> = Vec::new();
    let mut locations: Vec<Value> = Vec::new();

    for patch in patches {
        let Some(hunks) = patch.get("hunks").and_then(Value::as_array) else {
            continue;
        };
        if hunks.is_empty() {
            continue;
        }
        let file_path = patch
            .get("newFileName")
            .and_then(Value::as_str)
            .or_else(|| patch.get("oldFileName").and_then(Value::as_str))
            .unwrap_or_default();

        let mut old_lines: Vec<&str> = Vec::new();
        let mut new_lines: Vec<&str> = Vec::new();
        for hunk in hunks {
            let Some(lines) = hunk.get("lines").and_then(Value::as_array) else {
                continue;
            };
            for line in lines.iter().filter_map(Value::as_str) {
                if let Some(rest) = line.strip_prefix('-') {
                    old_lines.push(rest);
                } else if let Some(rest) = line.strip_prefix('+') {
                    new_lines.push(rest);
                } else if let Some(rest) = line.strip_prefix(' ') {
                    old_lines.push(rest);
                    new_lines.push(rest);
                }
            }
        }

        content.push(json!({
            "type": "diff",
            "path": file_path,
            "oldText": old_lines.join("\n"),
            "newText": new_lines.join("\n"),
        }));
        locations.push(json!({
            "path": file_path,
            "line": hunks[0].get("newStart"),
        }));
    }

    if content.is_empty() {
        return None;
    }
    Some((json!(content), json!(locations)))
}

/// `handleResultMessage`: map a `result` message to the turn outcome.
pub fn convert_result(message: &Value) -> TurnOutcome {
    let usage = extract_usage(message);
    let subtype = message.get("subtype").and_then(Value::as_str).unwrap_or("");
    let is_error = message
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let stop_reason_max_tokens =
        message.get("stop_reason").and_then(Value::as_str) == Some("max_tokens");

    match subtype {
        "success" => {
            let result_text = message.get("result").and_then(Value::as_str).unwrap_or("");
            if result_text.contains("Please run /login") {
                return TurnOutcome {
                    stop_reason: None,
                    error: Some(("Authentication required".into(), json!({}))),
                    usage,
                };
            }
            if stop_reason_max_tokens {
                return TurnOutcome {
                    stop_reason: Some("max_tokens".into()),
                    error: None,
                    usage,
                };
            }
            if is_error {
                let classification = crate::error_class::classify_agent_error(result_text);
                return TurnOutcome {
                    stop_reason: None,
                    error: Some((
                        result_text.to_string(),
                        json!({ "classification": classification, "result": result_text }),
                    )),
                    usage,
                };
            }
            TurnOutcome {
                stop_reason: Some("end_turn".into()),
                error: None,
                usage,
            }
        }
        "error_during_execution" => {
            if stop_reason_max_tokens {
                return TurnOutcome {
                    stop_reason: Some("max_tokens".into()),
                    error: None,
                    usage,
                };
            }
            if is_error {
                let errors = joined_errors(message, subtype);
                return TurnOutcome {
                    stop_reason: None,
                    error: Some((errors, json!({}))),
                    usage,
                };
            }
            TurnOutcome {
                stop_reason: Some("end_turn".into()),
                error: None,
                usage,
            }
        }
        "error_max_budget_usd" | "error_max_turns" | "error_max_structured_output_retries" => {
            if is_error {
                let errors = joined_errors(message, subtype);
                return TurnOutcome {
                    stop_reason: None,
                    error: Some((errors, json!({}))),
                    usage,
                };
            }
            TurnOutcome {
                stop_reason: Some("max_turn_requests".into()),
                error: None,
                usage,
            }
        }
        _ => TurnOutcome {
            stop_reason: None,
            error: None,
            usage,
        },
    }
}

fn joined_errors(message: &Value, subtype: &str) -> String {
    message
        .get("errors")
        .and_then(Value::as_array)
        .map(|errors| {
            errors
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(", ")
        })
        .filter(|joined| !joined.is_empty())
        .unwrap_or_else(|| subtype.to_string())
}

fn extract_usage(message: &Value) -> Option<Value> {
    let usage = message.get("usage")?;
    let mut out = json!({
        "inputTokens": usage.get("input_tokens").and_then(Value::as_i64).unwrap_or(0),
        "outputTokens": usage.get("output_tokens").and_then(Value::as_i64).unwrap_or(0),
        "cachedReadTokens": usage.get("cache_read_input_tokens").and_then(Value::as_i64).unwrap_or(0),
        "cachedWriteTokens": usage.get("cache_creation_input_tokens").and_then(Value::as_i64).unwrap_or(0),
    });
    if let Some(cost) = message.get("total_cost_usd").and_then(Value::as_f64) {
        out["costUsd"] = json!(cost);
    }
    if let Some(model_usage) = message.get("modelUsage").and_then(Value::as_object) {
        let min_window = model_usage
            .values()
            .filter_map(|m| m.get("contextWindow").and_then(Value::as_i64))
            .min();
        if let Some(window) = min_window {
            out["contextWindowSize"] = json!(window);
        }
    }
    Some(out)
}

fn bash_command_for(name: &str, input: &Value) -> Option<String> {
    if name != "Bash" {
        return None;
    }
    input
        .get("command")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn tool_meta(
    tool_name: &str,
    tool_response: Option<&Value>,
    parent_tool_call_id: Option<&str>,
    bash_command: Option<&str>,
) -> Value {
    let mut claude_code = Map::new();
    claude_code.insert("toolName".into(), json!(tool_name));
    if let Some(response) = tool_response {
        claude_code.insert("toolResponse".into(), response.clone());
    }
    if let Some(parent) = parent_tool_call_id {
        claude_code.insert("parentToolCallId".into(), json!(parent));
    }
    if let Some(command) = bash_command {
        claude_code.insert("bashCommand".into(), json!(command));
    }
    json!({ "claudeCode": Value::Object(claude_code) })
}

fn normalize_result_content(content: &Value) -> Value {
    match content {
        Value::Array(_) => content.clone(),
        Value::String(text) => json!([{ "type": "text", "text": text }]),
        _ => json!([]),
    }
}

fn result_text(content: &Value) -> Option<String> {
    match content {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let parts: Vec<&str> = items
                .iter()
                .filter_map(|item| item.get("text").and_then(Value::as_str))
                .collect();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join(""))
            }
        }
        _ => None,
    }
}

pub struct ToolInfo {
    pub title: String,
    pub kind: &'static str,
    pub content: Value,
    pub locations: Option<Value>,
}

fn text_content(text: String) -> Value {
    json!([{ "type": "content", "content": { "type": "text", "text": text } }])
}

fn display_path(file_path: &str, cwd: &str) -> String {
    let path = std::path::Path::new(file_path);
    let base = std::path::Path::new(cwd);
    match path.strip_prefix(base) {
        Ok(relative) if !relative.as_os_str().is_empty() => relative.display().to_string(),
        _ => file_path.to_string(),
    }
}

fn input_str<'a>(input: &'a Value, key: &str) -> Option<&'a str> {
    input.get(key).and_then(Value::as_str)
}

/// `toolInfoFromToolUse` — title/kind/content/locations per tool.
pub fn tool_info(name: &str, input: &Value, cwd: &str) -> ToolInfo {
    match name {
        "Task" | "Agent" => ToolInfo {
            title: input_str(input, "description").unwrap_or(name).to_string(),
            kind: "think",
            content: input_str(input, "prompt")
                .map(|p| text_content(p.to_string()))
                .unwrap_or_else(|| json!([])),
            locations: None,
        },
        "Bash" => ToolInfo {
            title: input_str(input, "description")
                .unwrap_or("Execute command")
                .to_string(),
            kind: "execute",
            content: input_str(input, "command")
                .map(|c| text_content(c.to_string()))
                .unwrap_or_else(|| json!([])),
            locations: None,
        },
        "BashOutput" => ToolInfo {
            title: "Tail Logs".into(),
            kind: "execute",
            content: json!([]),
            locations: None,
        },
        "KillShell" => ToolInfo {
            title: "Kill Process".into(),
            kind: "execute",
            content: json!([]),
            locations: None,
        },
        "Read" => {
            let offset = input.get("offset").and_then(Value::as_i64).unwrap_or(1);
            let limit_suffix = match input.get("limit").and_then(Value::as_i64) {
                Some(limit) => format!(" ({} - {})", offset, offset + limit - 1),
                None if offset > 1 => format!(" (from line {offset})"),
                None => String::new(),
            };
            let file_path = input_str(input, "file_path");
            let display = file_path
                .map(|p| display_path(p, cwd))
                .unwrap_or_else(|| "File".to_string());
            ToolInfo {
                title: format!("Read {display}{limit_suffix}"),
                kind: "read",
                content: json!([]),
                locations: file_path.map(|p| json!([{ "path": p, "line": offset }])),
            }
        }
        "LS" => ToolInfo {
            title: match input_str(input, "path") {
                Some(path) => format!("List the `{path}` directory's contents"),
                None => "List the current directory's contents".to_string(),
            },
            kind: "search",
            content: json!([]),
            locations: Some(json!([])),
        },
        "Edit" => {
            let file_path = input_str(input, "file_path");
            let title = file_path
                .map(|p| format!("Edit `{}`", display_path(p, cwd)))
                .unwrap_or_else(|| "Edit".to_string());
            let content = match file_path {
                Some(path) => json!([{
                    "type": "diff",
                    "path": path,
                    "oldText": input_str(input, "old_string"),
                    "newText": input_str(input, "new_string").unwrap_or(""),
                }]),
                None => json!([]),
            };
            ToolInfo {
                title,
                kind: "edit",
                content,
                locations: file_path.map(|p| json!([{ "path": p }])),
            }
        }
        "Write" => {
            let file_path = input_str(input, "file_path");
            let content_str = input_str(input, "content").unwrap_or("");
            let content = match file_path {
                Some(path) => {
                    let old = std::fs::read_to_string(path).ok();
                    json!([{
                        "type": "diff",
                        "path": path,
                        "oldText": old,
                        "newText": content_str,
                    }])
                }
                None if !content_str.is_empty() => text_content(content_str.to_string()),
                None => json!([]),
            };
            ToolInfo {
                title: file_path
                    .map(|p| format!("Write {}", display_path(p, cwd)))
                    .unwrap_or_else(|| "Write".to_string()),
                kind: "edit",
                content,
                locations: file_path.map(|p| json!([{ "path": p }])),
            }
        }
        "Glob" => {
            let mut label = "Find".to_string();
            if let Some(path) = input_str(input, "path") {
                label.push_str(&format!(" \"{path}\""));
            }
            if let Some(pattern) = input_str(input, "pattern") {
                label.push_str(&format!(" \"{pattern}\""));
            }
            ToolInfo {
                title: label,
                kind: "search",
                content: json!([]),
                locations: input_str(input, "path").map(|p| json!([{ "path": p }])),
            }
        }
        "Grep" => {
            let mut label = "grep".to_string();
            if input.get("-i").is_some_and(|v| v.as_bool() == Some(true)) {
                label.push_str(" -i");
            }
            if input.get("-n").is_some_and(|v| v.as_bool() == Some(true)) {
                label.push_str(" -n");
            }
            match input.get("output_mode").and_then(Value::as_str) {
                Some("files_with_matches") => label.push_str(" -l"),
                Some("count") => label.push_str(" -c"),
                _ => {}
            }
            if let Some(glob) = input_str(input, "glob") {
                label.push_str(&format!(" --include=\"{glob}\""));
            }
            if let Some(pattern) = input_str(input, "pattern") {
                label.push_str(&format!(" \"{pattern}\""));
            }
            if let Some(path) = input_str(input, "path") {
                label.push_str(&format!(" {path}"));
            }
            ToolInfo {
                title: label,
                kind: "search",
                content: json!([]),
                locations: None,
            }
        }
        "WebFetch" => ToolInfo {
            title: "Fetch".into(),
            kind: "fetch",
            content: match input_str(input, "url") {
                Some(url) => json!([{
                    "type": "content",
                    "content": {
                        "type": "resource_link",
                        "uri": url,
                        "name": url,
                        "description": input_str(input, "prompt"),
                    },
                }]),
                None => json!([]),
            },
            locations: None,
        },
        "WebSearch" => ToolInfo {
            title: format!("\"{}\"", input_str(input, "query").unwrap_or("")),
            kind: "fetch",
            content: json!([]),
            locations: None,
        },
        "Skill" => ToolInfo {
            title: match input_str(input, "skill") {
                Some(skill) => format!("Skill: {skill}"),
                None => "Skill".to_string(),
            },
            kind: "other",
            content: input_str(input, "args")
                .map(|a| text_content(a.to_string()))
                .unwrap_or_else(|| json!([])),
            locations: None,
        },
        "ExitPlanMode" => ToolInfo {
            title: "Ready to code?".into(),
            kind: "switch_mode",
            content: input_str(input, "plan")
                .map(|p| text_content(p.to_string()))
                .unwrap_or_else(|| json!([])),
            locations: None,
        },
        "AskUserQuestion" => {
            let questions = input.get("questions").and_then(Value::as_array);
            let title = questions
                .and_then(|qs| qs.first())
                .and_then(|q| q.get("question"))
                .and_then(Value::as_str)
                .unwrap_or("Question")
                .to_string();
            ToolInfo {
                title,
                kind: "other",
                content: match input.get("questions") {
                    Some(questions) => {
                        text_content(serde_json::to_string_pretty(questions).unwrap_or_default())
                    }
                    None => json!([]),
                },
                locations: None,
            }
        }
        "NotebookRead" => ToolInfo {
            title: match input_str(input, "notebook_path") {
                Some(path) => format!("Read Notebook {path}"),
                None => "Read Notebook".to_string(),
            },
            kind: "read",
            content: json!([]),
            locations: input_str(input, "notebook_path").map(|p| json!([{ "path": p }])),
        },
        "NotebookEdit" => ToolInfo {
            title: match input_str(input, "notebook_path") {
                Some(path) => format!("Edit Notebook {path}"),
                None => "Edit Notebook".to_string(),
            },
            kind: "edit",
            content: input_str(input, "new_source")
                .map(|s| text_content(s.to_string()))
                .unwrap_or_else(|| json!([])),
            locations: input_str(input, "notebook_path").map(|p| json!([{ "path": p }])),
        },
        name if name.starts_with("mcp__") => ToolInfo {
            // mcp__<server>__<tool> → the bare tool name.
            title: name.splitn(3, "__").nth(2).unwrap_or(name).to_string(),
            kind: "other",
            content: json!([]),
            locations: None,
        },
        other => ToolInfo {
            title: if other.is_empty() {
                "Unknown Tool".into()
            } else {
                other.to_string()
            },
            kind: "other",
            content: json!([]),
            locations: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_info_matches_ts_titles() {
        let read = tool_info(
            "Read",
            &json!({ "file_path": "/repo/src/main.rs", "offset": 5, "limit": 10 }),
            "/repo",
        );
        assert_eq!(read.title, "Read src/main.rs (5 - 14)");
        assert_eq!(read.kind, "read");

        let bash = tool_info(
            "Bash",
            &json!({ "command": "ls", "description": "List" }),
            "/repo",
        );
        assert_eq!(bash.title, "List");
        assert_eq!(bash.kind, "execute");

        let grep = tool_info(
            "Grep",
            &json!({ "pattern": "foo", "output_mode": "files_with_matches", "glob": "*.rs" }),
            "/repo",
        );
        assert_eq!(grep.title, "grep -l --include=\"*.rs\" \"foo\"");

        let mcp = tool_info(
            "mcp__posthog-code-tools__git_signed_commit",
            &json!({}),
            "/repo",
        );
        assert_eq!(mcp.title, "git_signed_commit");
    }

    #[test]
    fn stream_then_consolidated_dedupes_text_and_refines_tools() {
        let mut converter = Converter::new("/repo");

        // Streamed text delta emits a chunk.
        let deltas = converter.convert(&json!({
            "type": "stream_event",
            "parent_tool_use_id": null,
            "event": {
                "type": "content_block_delta", "index": 0,
                "delta": { "type": "text_delta", "text": "Hello" },
            },
        }));
        assert_eq!(deltas.len(), 1);

        // tool_use streamed at content_block_start → tool_call pending.
        let started = converter.convert(&json!({
            "type": "stream_event",
            "parent_tool_use_id": null,
            "event": {
                "type": "content_block_start", "index": 1,
                "content_block": { "type": "tool_use", "id": "t1", "name": "Bash", "input": {} },
            },
        }));
        let Outgoing::Update(update) = &started[0] else {
            panic!("expected update")
        };
        assert_eq!(update["sessionUpdate"], "tool_call");
        assert_eq!(update["status"], "pending");

        // Consolidated assistant message: text dropped, tool refined.
        let consolidated = converter.convert(&json!({
            "type": "assistant",
            "parent_tool_use_id": null,
            "message": { "content": [
                { "type": "text", "text": "Hello" },
                { "type": "tool_use", "id": "t1", "name": "Bash",
                  "input": { "command": "ls -la", "description": "List files" } },
            ]},
        }));
        assert_eq!(consolidated.len(), 1);
        let Outgoing::Update(update) = &consolidated[0] else {
            panic!("expected update")
        };
        assert_eq!(update["sessionUpdate"], "tool_call_update");
        assert_eq!(update["title"], "List files");
        assert_eq!(update["rawInput"]["command"], "ls -la");

        // Tool result completes the call with rawOutput.
        let results = converter.convert(&json!({
            "type": "user",
            "parent_tool_use_id": null,
            "message": { "content": [
                { "type": "tool_result", "tool_use_id": "t1", "content": "total 0", "is_error": false },
            ]},
        }));
        let Outgoing::Update(update) = &results[0] else {
            panic!("expected update")
        };
        assert_eq!(update["sessionUpdate"], "tool_call_update");
        assert_eq!(update["status"], "completed");
        assert_eq!(update["rawOutput"]["content"][0]["text"], "total 0");
        assert_eq!(update["_meta"]["claudeCode"]["bashCommand"], "ls -la");
    }

    #[test]
    fn task_tools_become_plan_updates() {
        let mut converter = Converter::new("/repo");
        converter.convert(&json!({
            "type": "assistant", "parent_tool_use_id": null,
            "message": { "content": [
                { "type": "tool_use", "id": "task1", "name": "TaskCreate",
                  "input": { "subject": "Fix the bug" } },
            ]},
        }));
        let updates = converter.convert(&json!({
            "type": "user", "parent_tool_use_id": null,
            "message": { "content": [
                { "type": "tool_result", "tool_use_id": "task1",
                  "content": "Task #7 created successfully: Fix the bug", "is_error": false },
            ]},
        }));
        let Outgoing::Update(update) = &updates[0] else {
            panic!("expected plan")
        };
        assert_eq!(update["sessionUpdate"], "plan");
        assert_eq!(update["entries"][0]["content"], "Fix the bug");
        assert_eq!(update["entries"][0]["status"], "pending");
    }

    #[test]
    fn result_mapping_matches_ts() {
        let success = convert_result(&json!({
            "type": "result", "subtype": "success", "is_error": false,
            "result": "done",
            "usage": { "input_tokens": 10, "output_tokens": 5 },
            "total_cost_usd": 0.5,
            "modelUsage": { "opus": { "contextWindow": 200000 } },
        }));
        assert_eq!(success.stop_reason.as_deref(), Some("end_turn"));
        let usage = success.usage.unwrap();
        assert_eq!(usage["inputTokens"], 10);
        assert_eq!(usage["contextWindowSize"], 200000);

        let max_turns = convert_result(&json!({
            "type": "result", "subtype": "error_max_turns", "is_error": false, "errors": [],
        }));
        assert_eq!(max_turns.stop_reason.as_deref(), Some("max_turn_requests"));

        let api_error = convert_result(&json!({
            "type": "result", "subtype": "success", "is_error": true,
            "result": "API Error: 529 overloaded",
        }));
        let (message, data) = api_error.error.unwrap();
        assert!(message.contains("529"));
        assert_eq!(data["classification"], "upstream_provider_failure");
    }

    #[test]
    fn rehydrates_task_state_from_jsonl_messages() {
        let mut converter = Converter::new("/tmp");
        let messages = vec![
            json!({ "type": "assistant", "message": { "content": [
                { "type": "tool_use", "id": "t1", "name": "TaskCreate",
                  "input": { "subject": "Port the driver" } },
            ]}}),
            json!({ "type": "user", "message": { "content": [
                { "type": "tool_result", "tool_use_id": "t1", "content": "Task #7 created" },
            ]}}),
            json!({ "type": "assistant", "message": { "content": [
                { "type": "tool_use", "id": "t2", "name": "TaskUpdate",
                  "input": { "taskId": "7", "status": "in_progress" } },
            ]}}),
            json!({ "type": "user", "message": { "content": [
                { "type": "tool_result", "tool_use_id": "t2", "content": "updated" },
            ]}}),
            // Errored calls are ignored — this completion must not apply.
            json!({ "type": "assistant", "message": { "content": [
                { "type": "tool_use", "id": "t3", "name": "TaskUpdate",
                  "input": { "taskId": "7", "status": "completed" } },
            ]}}),
            json!({ "type": "user", "message": { "content": [
                { "type": "tool_result", "tool_use_id": "t3", "is_error": true, "content": "boom" },
            ]}}),
        ];

        let update = converter
            .rehydrate_task_state(&messages)
            .expect("plan update");
        assert_eq!(update["sessionUpdate"], "plan");
        assert_eq!(update["entries"][0]["content"], "Port the driver");
        assert_eq!(update["entries"][0]["status"], "in_progress");

        // No transcript, no update.
        assert!(Converter::new("/tmp").rehydrate_task_state(&[]).is_none());
    }
}
