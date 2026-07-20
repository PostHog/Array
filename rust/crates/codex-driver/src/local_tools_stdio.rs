//! Stdio MCP server mode: the codex app-server spawns the driver binary with
//! `--local-tools-mcp` as its `posthog-code-tools` MCP server. Port of
//! `local-tools-mcp-server.ts`: context (cwd, taskId, token, baseBranch)
//! arrives base64-JSON in `POSTHOG_LOCAL_TOOLS_CTX`, the tool allowlist in
//! `POSTHOG_LOCAL_TOOLS_ENABLED` (the parent already evaluated each tool's
//! gate).

use std::collections::HashSet;
use std::io::Write as _;
use std::path::PathBuf;

use base64::Engine as _;
use serde_json::Value;

use posthog_agent_tools::mcp::LocalToolsServer;

fn die(message: &str) -> ! {
    eprintln!("[local-tools-mcp-server] {message}");
    std::process::exit(1);
}

struct Ctx {
    cwd: String,
    task_id: Option<String>,
    base_branch: Option<String>,
}

fn parse_ctx() -> Ctx {
    let Ok(raw) = std::env::var("POSTHOG_LOCAL_TOOLS_CTX") else {
        die("POSTHOG_LOCAL_TOOLS_CTX env var is required");
    };
    let decoded = match base64::engine::general_purpose::STANDARD.decode(&raw) {
        Ok(decoded) => decoded,
        Err(err) => die(&format!(
            "Failed to parse POSTHOG_LOCAL_TOOLS_CTX as base64-encoded JSON: {err}"
        )),
    };
    let parsed: Value = match serde_json::from_slice(&decoded) {
        Ok(parsed) => parsed,
        Err(err) => die(&format!(
            "Failed to parse POSTHOG_LOCAL_TOOLS_CTX as base64-encoded JSON: {err}"
        )),
    };
    let Some(cwd) = parsed
        .get("cwd")
        .and_then(Value::as_str)
        .filter(|c| !c.is_empty())
    else {
        die("POSTHOG_LOCAL_TOOLS_CTX must include cwd");
    };
    Ctx {
        cwd: cwd.to_string(),
        task_id: parsed
            .get("taskId")
            .and_then(Value::as_str)
            .map(str::to_string),
        base_branch: parsed
            .get("baseBranch")
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

fn enabled_tools() -> HashSet<String> {
    std::env::var("POSTHOG_LOCAL_TOOLS_ENABLED")
        .unwrap_or_default()
        .split(',')
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect()
}

/// Drop tools/list entries outside the parent's allowlist.
fn filter_tools_list(response: &mut Value, enabled: &HashSet<String>) {
    if enabled.is_empty() {
        return;
    }
    if let Some(tools) = response
        .pointer_mut("/result/tools")
        .and_then(Value::as_array_mut)
    {
        tools.retain(|tool| {
            tool.get("name")
                .and_then(Value::as_str)
                .map(|name| enabled.contains(name))
                .unwrap_or(false)
        });
    }
}

pub async fn run() {
    let ctx = parse_ctx();
    let enabled = enabled_tools();
    let server = LocalToolsServer::new(PathBuf::from(&ctx.cwd), ctx.task_id, ctx.base_branch);

    let stdin = tokio::io::stdin();
    let mut lines = tokio::io::BufReader::new(stdin);
    let mut line = String::new();
    loop {
        line.clear();
        match tokio::io::AsyncBufReadExt::read_line(&mut lines, &mut line).await {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => break,
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        // Requests only; MCP notifications (notifications/initialized) need no reply.
        let is_request = message.get("method").is_some()
            && message.get("id").map(|id| !id.is_null()).unwrap_or(false);
        if !is_request {
            continue;
        }
        let mut response = server.handle_request(&message).await;
        if message.get("method").and_then(Value::as_str) == Some("tools/list") {
            filter_tools_list(&mut response, &enabled);
        }
        let mut stdout = std::io::stdout().lock();
        if writeln!(stdout, "{response}").is_err() {
            break;
        }
        let _ = stdout.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tools_list_is_filtered_to_the_allowlist() {
        let mut response = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": { "tools": [
                { "name": "git_signed_commit" },
                { "name": "git_signed_merge" },
                { "name": "git_signed_rewrite" },
            ]},
        });
        let enabled: HashSet<String> = ["git_signed_commit".to_string()].into_iter().collect();
        filter_tools_list(&mut response, &enabled);
        let tools = response["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "git_signed_commit");
    }
}
