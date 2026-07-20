//! JSON-RPC command validation for `POST /command`.
//!
//! Mirrors `packages/agent/src/server/schemas.ts` — method aliases, param
//! schemas, and error strings are part of the Django contract
//! (`send_agent_command` in posthog/posthog switches on them).

use serde_json::Value;

/// The canonical command methods (after alias resolution).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandMethod {
    UserMessage,
    Cancel,
    Close,
    PermissionResponse,
    SetConfigOption,
    RefreshSession,
}

/// Resolve a wire method name to its canonical command, mirroring the
/// `commandParamsSchemas` key set plus the `^_?posthog/` strip fallback.
pub fn resolve_method(method: &str) -> Option<CommandMethod> {
    let direct = match method {
        "user_message" | "posthog/user_message" | "_posthog/user_message" => {
            Some(CommandMethod::UserMessage)
        }
        "cancel" | "posthog/cancel" | "_posthog/cancel" => Some(CommandMethod::Cancel),
        "close" | "posthog/close" | "_posthog/close" => Some(CommandMethod::Close),
        "permission_response" | "posthog/permission_response" | "_posthog/permission_response" => {
            Some(CommandMethod::PermissionResponse)
        }
        "set_config_option" | "posthog/set_config_option" | "_posthog/set_config_option" => {
            Some(CommandMethod::SetConfigOption)
        }
        "refresh_session" | "posthog/refresh_session" | "_posthog/refresh_session" => {
            Some(CommandMethod::RefreshSession)
        }
        _ => None,
    };
    if direct.is_some() {
        return direct;
    }
    // schemas.ts falls back to stripping a leading `_posthog/` or `posthog/`.
    let stripped = method
        .strip_prefix("_posthog/")
        .or_else(|| method.strip_prefix("posthog/"))?;
    resolve_method(stripped)
}

/// Result of `validate_command_params` — mirrors `{success, error}`.
pub fn validate_command_params(method: &str, params: &Value) -> Result<CommandMethod, String> {
    let Some(command) = resolve_method(method) else {
        return Err(format!("Unknown method: {method}"));
    };

    match command {
        CommandMethod::UserMessage => validate_user_message(params)?,
        CommandMethod::PermissionResponse => validate_permission_response(params)?,
        CommandMethod::SetConfigOption => validate_set_config_option(params)?,
        CommandMethod::RefreshSession => validate_refresh_session(params)?,
        // cancel: optional empty object; close: optional {localGitState?}.
        CommandMethod::Cancel | CommandMethod::Close => {}
    }

    Ok(command)
}

fn validate_user_message(params: &Value) -> Result<(), String> {
    let content = params.get("content");
    let artifacts = params.get("artifacts");

    let has_content = match content {
        Some(Value::String(s)) => !s.trim().is_empty(),
        Some(Value::Array(items)) => !items.is_empty(),
        Some(_) => return Err("Content is required".to_string()),
        None => false,
    };
    let has_artifacts = matches!(artifacts, Some(Value::Array(items)) if !items.is_empty());

    if !has_content && !has_artifacts {
        return Err("Either content or artifacts are required".to_string());
    }
    Ok(())
}

fn require_non_empty_string(params: &Value, key: &str, message: &str) -> Result<(), String> {
    match params.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Ok(()),
        _ => Err(message.to_string()),
    }
}

fn validate_permission_response(params: &Value) -> Result<(), String> {
    require_non_empty_string(params, "requestId", "requestId is required")?;
    require_non_empty_string(params, "optionId", "optionId is required")?;
    Ok(())
}

fn validate_set_config_option(params: &Value) -> Result<(), String> {
    require_non_empty_string(params, "configId", "configId is required")?;
    require_non_empty_string(params, "value", "value is required")?;
    Ok(())
}

fn validate_refresh_session(params: &Value) -> Result<(), String> {
    let Some(servers) = params.get("mcpServers") else {
        return Err("mcpServers is required".to_string());
    };
    let Some(servers) = servers.as_array() else {
        return Err("mcpServers must be an array".to_string());
    };
    for server in servers {
        match server.get("type").and_then(Value::as_str) {
            Some("http") | Some("sse") => {}
            _ => return Err("MCP server type must be \"http\" or \"sse\"".to_string()),
        }
        match server.get("name").and_then(Value::as_str) {
            Some(name) if !name.is_empty() => {}
            _ => return Err("MCP server name is required".to_string()),
        }
        match server.get("url").and_then(Value::as_str) {
            Some(url) if url.starts_with("http://") || url.starts_with("https://") => {}
            _ => return Err("MCP server url must be a valid URL".to_string()),
        }
    }
    Ok(())
}

/// A parsed JSON-RPC request from `POST /command`
/// (`jsonRpcRequestSchema` in schemas.ts).
#[derive(Debug, Clone)]
pub struct JsonRpcCommand {
    pub method: String,
    pub params: Value,
    pub id: Option<Value>,
}

/// Parse a request body, mirroring `jsonRpcRequestSchema` — `jsonrpc` must be
/// exactly "2.0", `method` a string, `params` an object when present, `id` a
/// string or number when present.
pub fn parse_json_rpc(body: &Value) -> Option<JsonRpcCommand> {
    if body.get("jsonrpc")?.as_str()? != "2.0" {
        return None;
    }
    let method = body.get("method")?.as_str()?.to_string();
    let params = match body.get("params") {
        None | Some(Value::Null) => Value::Object(Default::default()),
        Some(Value::Object(map)) => Value::Object(map.clone()),
        Some(_) => return None,
    };
    let id = match body.get("id") {
        None => None,
        Some(id @ Value::String(_)) | Some(id @ Value::Number(_)) => Some(id.clone()),
        Some(_) => return None,
    };
    Some(JsonRpcCommand { method, params, id })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn resolves_all_aliases() {
        for method in [
            "user_message",
            "posthog/user_message",
            "_posthog/user_message",
        ] {
            assert_eq!(
                resolve_method(method),
                Some(CommandMethod::UserMessage),
                "{method}"
            );
        }
        for method in ["cancel", "posthog/cancel", "_posthog/cancel"] {
            assert_eq!(
                resolve_method(method),
                Some(CommandMethod::Cancel),
                "{method}"
            );
        }
        for method in [
            "refresh_session",
            "posthog/refresh_session",
            "_posthog/refresh_session",
        ] {
            assert_eq!(
                resolve_method(method),
                Some(CommandMethod::RefreshSession),
                "{method}"
            );
        }
        assert_eq!(resolve_method("nope"), None);
    }

    #[test]
    fn unknown_method_error_matches_ts() {
        let err = validate_command_params("frobnicate", &json!({})).unwrap_err();
        assert_eq!(err, "Unknown method: frobnicate");
    }

    #[test]
    fn user_message_requires_content_or_artifacts() {
        assert!(validate_command_params("user_message", &json!({})).is_err());
        assert!(validate_command_params("user_message", &json!({"content": "  "})).is_err());
        assert!(validate_command_params("user_message", &json!({"content": []})).is_err());
        assert!(validate_command_params("user_message", &json!({"content": "hi"})).is_ok());
        assert!(validate_command_params(
            "user_message",
            &json!({"content": [{"type":"text","text":"x"}]})
        )
        .is_ok());
        assert!(
            validate_command_params("user_message", &json!({"artifacts": [{"id":"a"}]})).is_ok()
        );
    }

    #[test]
    fn permission_response_requires_ids() {
        assert!(validate_command_params("permission_response", &json!({})).is_err());
        assert!(validate_command_params(
            "permission_response",
            &json!({"requestId": "r", "optionId": "o"})
        )
        .is_ok());
    }

    #[test]
    fn refresh_session_validates_server_entries() {
        assert!(validate_command_params("refresh_session", &json!({})).is_err());
        assert!(validate_command_params("refresh_session", &json!({"mcpServers": []})).is_ok());
        assert!(validate_command_params(
            "refresh_session",
            &json!({"mcpServers": [{"type": "http", "name": "posthog", "url": "https://x.test"}]})
        )
        .is_ok());
        assert!(validate_command_params(
            "refresh_session",
            &json!({"mcpServers": [{"type": "ftp", "name": "posthog", "url": "https://x.test"}]})
        )
        .is_err());
    }

    #[test]
    fn cancel_accepts_missing_and_empty_params() {
        assert!(validate_command_params("cancel", &json!({})).is_ok());
        assert!(validate_command_params("_posthog/cancel", &json!({})).is_ok());
    }

    #[test]
    fn parses_json_rpc_shapes() {
        assert!(parse_json_rpc(&json!({"jsonrpc": "2.0", "method": "cancel"})).is_some());
        assert!(parse_json_rpc(&json!({"jsonrpc": "2.0", "method": "m", "id": 3})).is_some());
        assert!(parse_json_rpc(&json!({"jsonrpc": "2.0", "method": "m", "id": "abc"})).is_some());
        assert!(parse_json_rpc(&json!({"jsonrpc": "1.0", "method": "m"})).is_none());
        assert!(parse_json_rpc(&json!({"method": "m"})).is_none());
        assert!(parse_json_rpc(&json!({"jsonrpc": "2.0", "method": "m", "id": true})).is_none());
        assert!(parse_json_rpc(&json!({"jsonrpc": "2.0", "method": "m", "params": "x"})).is_none());
    }
}
