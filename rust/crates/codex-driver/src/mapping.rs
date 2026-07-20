//! app-server notification → ACP session-update conversion. Port of
//! `mapping.ts` (`mapAppServerNotification` and its helpers): streamed text
//! maps to chunks; tool-like items map to `tool_call`/`tool_call_update`;
//! agent-message and reasoning items are dropped — their deltas already
//! streamed.

use serde_json::{json, Value};

use crate::usage::read_token_usage;

pub mod notifications {
    pub const THREAD_STARTED: &str = "thread/started";
    pub const TURN_STARTED: &str = "turn/started";
    pub const ITEM_STARTED: &str = "item/started";
    pub const ITEM_COMPLETED: &str = "item/completed";
    pub const AGENT_MESSAGE_DELTA: &str = "item/agentMessage/delta";
    pub const REASONING_TEXT_DELTA: &str = "item/reasoning/textDelta";
    pub const REASONING_SUMMARY_TEXT_DELTA: &str = "item/reasoning/summaryTextDelta";
    pub const TURN_PLAN_UPDATED: &str = "turn/plan/updated";
    pub const TURN_COMPLETED: &str = "turn/completed";
    pub const ERROR: &str = "error";
    pub const TOKEN_USAGE_UPDATED: &str = "thread/tokenUsage/updated";
    pub const CONTEXT_COMPACTED: &str = "thread/compacted";
    pub const COMMAND_OUTPUT_DELTA: &str = "item/commandExecution/outputDelta";
    pub const TERMINAL_INTERACTION: &str = "item/commandExecution/terminalInteraction";
    pub const FILE_CHANGE_PATCH_UPDATED: &str = "item/fileChange/patchUpdated";
}

pub mod requests {
    pub const COMMAND_APPROVAL: &str = "item/commandExecution/requestApproval";
    pub const FILE_CHANGE_APPROVAL: &str = "item/fileChange/requestApproval";
    pub const TOOL_USER_INPUT: &str = "item/tool/requestUserInput";
    pub const PERMISSIONS_APPROVAL: &str = "item/permissions/requestApproval";
    pub const MCP_ELICITATION: &str = "mcpServer/elicitation/request";
}

fn text_update(update_type: &str, text: &str) -> Value {
    json!({
        "sessionUpdate": update_type,
        "content": { "type": "text", "text": text },
    })
}

/// A streamed text chunk on an in-progress tool call; the renderer appends
/// successive single-chunk updates.
fn tool_output_chunk(tool_call_id: &str, text: &str) -> Value {
    json!({
        "sessionUpdate": "tool_call_update",
        "toolCallId": tool_call_id,
        "status": "in_progress",
        "content": [{ "type": "content", "content": { "type": "text", "text": text } }],
    })
}

fn map_plan_status(status: Option<&str>) -> &'static str {
    match status {
        Some("inProgress") => "in_progress",
        Some("completed") => "completed",
        _ => "pending",
    }
}

fn map_status(status: Option<&str>) -> &'static str {
    match status {
        Some("completed") => "completed",
        Some("failed") | Some("declined") => "failed",
        _ => "in_progress",
    }
}

fn read_str<'a>(params: &'a Value, key: &str) -> Option<&'a str> {
    params.get(key).and_then(Value::as_str)
}

/// Translate a native app-server notification into an ACP session update
/// (the `update` object), or None when nothing should surface.
pub fn map_app_server_notification(method: &str, params: &Value) -> Option<Value> {
    match method {
        notifications::AGENT_MESSAGE_DELTA => {
            let delta = read_str(params, "delta").filter(|d| !d.is_empty())?;
            Some(text_update("agent_message_chunk", delta))
        }
        notifications::REASONING_TEXT_DELTA | notifications::REASONING_SUMMARY_TEXT_DELTA => {
            let delta = read_str(params, "delta").filter(|d| !d.is_empty())?;
            Some(text_update("agent_thought_chunk", delta))
        }
        notifications::TOKEN_USAGE_UPDATED => {
            // Context indicator: the renderer reads `used`/`size`; the
            // detailed breakdown comes via `_posthog/usage_update`.
            let (_, used, size) = read_token_usage(params)?;
            let mut update = json!({ "sessionUpdate": "usage_update", "used": used });
            if let Some(size) = size {
                update["size"] = json!(size);
            }
            Some(update)
        }
        notifications::TURN_PLAN_UPDATED => {
            let plan = params.get("plan").and_then(Value::as_array)?;
            let entries: Vec<Value> = plan
                .iter()
                .map(|step| {
                    json!({
                        "content": step.get("step").and_then(Value::as_str).unwrap_or(""),
                        "priority": "medium",
                        "status": map_plan_status(step.get("status").and_then(Value::as_str)),
                    })
                })
                .collect();
            Some(json!({ "sessionUpdate": "plan", "entries": entries }))
        }
        notifications::ITEM_STARTED | notifications::ITEM_COMPLETED => {
            let item = params.get("item")?;
            map_item(item, method == notifications::ITEM_COMPLETED)
        }
        notifications::COMMAND_OUTPUT_DELTA => {
            let item_id = read_str(params, "itemId")?;
            let delta = read_str(params, "delta").filter(|d| !d.is_empty())?;
            Some(tool_output_chunk(item_id, delta))
        }
        notifications::TERMINAL_INTERACTION => {
            let item_id = read_str(params, "itemId")?;
            let stdin = read_str(params, "stdin").filter(|s| !s.is_empty())?;
            Some(tool_output_chunk(item_id, stdin))
        }
        notifications::FILE_CHANGE_PATCH_UPDATED => {
            let item_id = read_str(params, "itemId")?;
            let content = diff_content(params.get("changes"))?;
            Some(json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": item_id,
                "status": "in_progress",
                "content": content,
            }))
        }
        _ => None,
    }
}

struct ToolDescriptor {
    title: String,
    kind: &'static str,
    raw_input: Option<Value>,
    output: Option<String>,
    locations: Option<Value>,
    /// Originating MCP server + tool, surfaced on `_meta.posthog` so the
    /// renderer routes MCP rendering.
    mcp: Option<(String, String)>,
}

/// Classify a shell command by its actions so read-only commands render as
/// read/search, not execute.
fn command_kind(actions: Option<&Vec<Value>>) -> &'static str {
    let Some(actions) = actions.filter(|a| !a.is_empty()) else {
        return "execute";
    };
    let types: Vec<&str> = actions
        .iter()
        .map(|a| {
            a.as_str()
                .or_else(|| a.get("type").and_then(Value::as_str))
                .unwrap_or("")
        })
        .collect();
    if types.iter().all(|t| *t == "read") {
        return "read";
    }
    if types.iter().all(|t| *t == "search" || *t == "listFiles") {
        return "search";
    }
    "execute"
}

fn mcp_result_text(item: &Value) -> Option<String> {
    if let Some(message) = item.pointer("/error/message").and_then(Value::as_str) {
        return Some(message.to_string());
    }
    let content = item.pointer("/result/content")?.as_array()?;
    let text: Vec<&str> = content
        .iter()
        .filter(|c| c.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|c| c.get("text").and_then(Value::as_str))
        .filter(|t| !t.is_empty())
        .collect();
    if text.is_empty() {
        None
    } else {
        Some(text.join("\n"))
    }
}

fn dynamic_tool_text(item: &Value) -> Option<String> {
    let items = item.get("contentItems")?.as_array()?;
    let text: Vec<&str> = items
        .iter()
        .filter(|c| c.get("type").and_then(Value::as_str) == Some("inputText"))
        .filter_map(|c| c.get("text").and_then(Value::as_str))
        .filter(|t| !t.is_empty())
        .collect();
    if text.is_empty() {
        None
    } else {
        Some(text.join("\n"))
    }
}

/// Distinct, non-empty changed paths for a fileChange item, order-preserved.
pub fn change_paths(changes: Option<&Value>) -> Vec<String> {
    let Some(changes) = changes.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut seen = std::collections::HashSet::new();
    let mut paths = Vec::new();
    for change in changes {
        if let Some(path) = change.get("path").and_then(Value::as_str) {
            if !path.is_empty() && seen.insert(path.to_string()) {
                paths.push(path.to_string());
            }
        }
    }
    paths
}

fn file_change_title(paths: &[String]) -> String {
    match paths.len() {
        0 => "Edit files".to_string(),
        1 => paths[0].clone(),
        n => format!("{} (+{} more)", paths[0], n - 1),
    }
}

/// Clickable locations for a commandExecution: action paths, else the cwd.
fn command_locations(item: &Value) -> Option<Value> {
    let mut seen = std::collections::HashSet::new();
    let mut paths: Vec<String> = Vec::new();
    if let Some(actions) = item.get("commandActions").and_then(Value::as_array) {
        for action in actions {
            if let Some(path) = action.get("path").and_then(Value::as_str) {
                if !path.is_empty() && seen.insert(path.to_string()) {
                    paths.push(path.to_string());
                }
            }
        }
    }
    if paths.is_empty() {
        if let Some(cwd) = item.get("cwd").and_then(Value::as_str) {
            paths.push(cwd.to_string());
        }
    }
    if paths.is_empty() {
        return None;
    }
    Some(json!(paths
        .iter()
        .map(|path| json!({ "path": path }))
        .collect::<Vec<_>>()))
}

fn describe_tool(item: &Value) -> Option<ToolDescriptor> {
    match item.get("type").and_then(Value::as_str) {
        Some("commandExecution") => Some(ToolDescriptor {
            title: item
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or("Run command")
                .to_string(),
            kind: command_kind(item.get("commandActions").and_then(Value::as_array)),
            raw_input: None,
            output: item
                .get("aggregatedOutput")
                .and_then(Value::as_str)
                .filter(|o| !o.is_empty())
                .map(str::to_string),
            locations: command_locations(item),
            mcp: None,
        }),
        Some("fileChange") => {
            let paths = change_paths(item.get("changes"));
            Some(ToolDescriptor {
                title: file_change_title(&paths),
                kind: "edit",
                raw_input: None,
                output: None,
                locations: if paths.is_empty() {
                    None
                } else {
                    Some(json!(paths
                        .iter()
                        .map(|path| json!({ "path": path }))
                        .collect::<Vec<_>>()))
                },
                mcp: None,
            })
        }
        Some("mcpToolCall") => {
            let server = item
                .get("server")
                .and_then(Value::as_str)
                .unwrap_or("mcp")
                .to_string();
            let tool = item
                .get("tool")
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_string();
            Some(ToolDescriptor {
                title: format!("{server}/{tool}"),
                kind: "other",
                raw_input: item.get("arguments").cloned(),
                output: mcp_result_text(item),
                locations: None,
                mcp: Some((server, tool)),
            })
        }
        Some("dynamicToolCall") => {
            let tool = item.get("tool").and_then(Value::as_str).unwrap_or("tool");
            let title = match item.get("namespace").and_then(Value::as_str) {
                Some(namespace) if !namespace.is_empty() => format!("{namespace}/{tool}"),
                _ => tool.to_string(),
            };
            Some(ToolDescriptor {
                title,
                kind: "other",
                raw_input: item.get("arguments").cloned(),
                output: dynamic_tool_text(item),
                locations: None,
                mcp: None,
            })
        }
        Some("webSearch") => Some(ToolDescriptor {
            title: item
                .get("query")
                .and_then(Value::as_str)
                .unwrap_or("Web search")
                .to_string(),
            kind: "fetch",
            raw_input: None,
            output: None,
            locations: None,
            mcp: None,
        }),
        _ => None,
    }
}

fn posthog_tool_meta(server: &str, tool: &str) -> Value {
    json!({
        "posthog": {
            "toolName": format!("mcp__{server}__{tool}"),
            "mcp": { "server": server, "tool": tool },
        },
    })
}

fn completed_content(item: &Value, tool: &ToolDescriptor) -> Option<Value> {
    if item.get("type").and_then(Value::as_str) == Some("fileChange") {
        if let Some(diffs) = diff_content(item.get("changes")) {
            return Some(diffs);
        }
    }
    tool.output
        .as_ref()
        .map(|output| json!([{ "type": "content", "content": { "type": "text", "text": output } }]))
}

fn map_item(item: &Value, completed: bool) -> Option<Value> {
    let tool = describe_tool(item)?;
    let item_id = item.get("id").and_then(Value::as_str)?;

    if !completed {
        let mut update = json!({
            "sessionUpdate": "tool_call",
            "toolCallId": item_id,
            "title": tool.title,
            "kind": tool.kind,
            "status": "in_progress",
        });
        if let Some(raw_input) = tool.raw_input {
            update["rawInput"] = raw_input;
        }
        if let Some(locations) = tool.locations {
            update["locations"] = locations;
        }
        if let Some((server, tool_name)) = &tool.mcp {
            update["_meta"] = posthog_tool_meta(server, tool_name);
        }
        return Some(update);
    }

    let mut update = json!({
        "sessionUpdate": "tool_call_update",
        "toolCallId": item_id,
        "status": map_status(item.get("status").and_then(Value::as_str)),
    });
    if let Some(content) = completed_content(item, &tool) {
        update["content"] = content;
    }
    Some(update)
}

/// Extract `{oldText, newText}` from a unified diff so a codex `fileChange`
/// renders as an ACP diff.
pub fn parse_unified_diff(diff: &str) -> (String, String) {
    let mut old_lines: Vec<&str> = Vec::new();
    let mut new_lines: Vec<&str> = Vec::new();
    for line in diff.split('\n') {
        // Skip diff/hunk metadata; match trailing space on ---/+++ so content
        // lines like "++i;" aren't dropped.
        if line.starts_with("@@")
            || line.starts_with("diff ")
            || line.starts_with("index ")
            || line.starts_with("--- ")
            || line.starts_with("+++ ")
            || line.starts_with("\\ ")
        {
            continue;
        }
        if let Some(rest) = line.strip_prefix('-') {
            old_lines.push(rest);
        } else if let Some(rest) = line.strip_prefix('+') {
            new_lines.push(rest);
        } else {
            let ctx = line.strip_prefix(' ').unwrap_or(line);
            old_lines.push(ctx);
            new_lines.push(ctx);
        }
    }
    (old_lines.join("\n"), new_lines.join("\n"))
}

/// Maps a fileChange's `changes[]` to ACP `diff` content blocks.
pub fn diff_content(changes: Option<&Value>) -> Option<Value> {
    let changes = changes.and_then(Value::as_array)?;
    let diffs: Vec<Value> = changes
        .iter()
        .filter_map(|change| {
            let diff = change.get("diff").and_then(Value::as_str)?;
            let (old_text, new_text) = parse_unified_diff(diff);
            Some(json!({
                "type": "diff",
                "path": change.get("path"),
                "oldText": old_text,
                "newText": new_text,
            }))
        })
        .collect();
    if diffs.is_empty() {
        None
    } else {
        Some(json!(diffs))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deltas_map_to_message_and_thought_chunks() {
        let update = map_app_server_notification(
            notifications::AGENT_MESSAGE_DELTA,
            &json!({ "delta": "hi" }),
        )
        .unwrap();
        assert_eq!(update["sessionUpdate"], "agent_message_chunk");
        assert_eq!(update["content"]["text"], "hi");

        let update = map_app_server_notification(
            notifications::REASONING_SUMMARY_TEXT_DELTA,
            &json!({ "delta": "think" }),
        )
        .unwrap();
        assert_eq!(update["sessionUpdate"], "agent_thought_chunk");
        assert!(map_app_server_notification(
            notifications::AGENT_MESSAGE_DELTA,
            &json!({ "delta": "" })
        )
        .is_none());
    }

    #[test]
    fn command_items_map_to_tool_calls_with_kind() {
        let started = map_app_server_notification(
            notifications::ITEM_STARTED,
            &json!({ "item": {
                "type": "commandExecution",
                "id": "item-1",
                "command": "cat foo.rs",
                "commandActions": [{ "type": "read", "path": "/repo/foo.rs" }],
            }}),
        )
        .unwrap();
        assert_eq!(started["sessionUpdate"], "tool_call");
        assert_eq!(started["kind"], "read");
        assert_eq!(started["locations"][0]["path"], "/repo/foo.rs");

        let completed = map_app_server_notification(
            notifications::ITEM_COMPLETED,
            &json!({ "item": {
                "type": "commandExecution",
                "id": "item-1",
                "command": "cat foo.rs",
                "status": "completed",
                "aggregatedOutput": "contents",
            }}),
        )
        .unwrap();
        assert_eq!(completed["sessionUpdate"], "tool_call_update");
        assert_eq!(completed["status"], "completed");
        assert_eq!(completed["content"][0]["content"]["text"], "contents");
    }

    #[test]
    fn mcp_items_carry_posthog_meta() {
        let update = map_app_server_notification(
            notifications::ITEM_STARTED,
            &json!({ "item": {
                "type": "mcpToolCall",
                "id": "item-2",
                "server": "posthog",
                "tool": "exec",
                "arguments": { "command": "call insight-list" },
            }}),
        )
        .unwrap();
        assert_eq!(update["title"], "posthog/exec");
        assert_eq!(update["_meta"]["posthog"]["toolName"], "mcp__posthog__exec");
        assert_eq!(update["rawInput"]["command"], "call insight-list");
    }

    #[test]
    fn agent_message_items_are_dropped_after_streaming() {
        assert!(map_app_server_notification(
            notifications::ITEM_COMPLETED,
            &json!({ "item": { "type": "agentMessage", "id": "m1", "text": "hi" } }),
        )
        .is_none());
        assert!(map_app_server_notification(
            notifications::ITEM_STARTED,
            &json!({ "item": { "type": "reasoning", "id": "r1" } }),
        )
        .is_none());
    }

    #[test]
    fn unified_diffs_split_into_old_and_new() {
        let (old_text, new_text) =
            parse_unified_diff("--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n ctx\n-old\n+new");
        assert_eq!(old_text, "ctx\nold");
        assert_eq!(new_text, "ctx\nnew");

        let content = diff_content(Some(&json!([
            { "path": "x.rs", "diff": "-a\n+b" },
            { "path": "y.rs" },
        ])))
        .unwrap();
        assert_eq!(content.as_array().unwrap().len(), 1);
        assert_eq!(content[0]["path"], "x.rs");
        assert_eq!(content[0]["oldText"], "a");
        assert_eq!(content[0]["newText"], "b");
    }

    #[test]
    fn plan_updates_map_statuses() {
        let update = map_app_server_notification(
            notifications::TURN_PLAN_UPDATED,
            &json!({ "plan": [
                { "step": "one", "status": "completed" },
                { "step": "two", "status": "inProgress" },
                { "step": "three" },
            ]}),
        )
        .unwrap();
        assert_eq!(update["sessionUpdate"], "plan");
        assert_eq!(update["entries"][0]["status"], "completed");
        assert_eq!(update["entries"][1]["status"], "in_progress");
        assert_eq!(update["entries"][2]["status"], "pending");
    }
}
