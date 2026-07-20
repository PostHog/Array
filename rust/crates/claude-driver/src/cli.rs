//! Claude Code CLI process spawn: argument construction and environment.
//!
//! Port of the SDK transport's arg building (`sdk.mjs` `initialize()`) plus
//! the PostHog session options from `adapters/claude/session/options.ts`
//! (`buildSessionOptions` / `buildEnvironment`).

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

/// `DEFAULT_MODEL` / `FALLBACK_MODEL` from `session/models.ts`.
pub const DEFAULT_MODEL: &str = "opus";
pub const FALLBACK_MODEL: &str = "claude-opus-4-8";

/// SDK MCP server name for the PostHog local tools (`LOCAL_TOOLS_MCP_NAME`).
pub const LOCAL_TOOLS_MCP_NAME: &str = "posthog-code-tools";

/// Gateway configuration handed over by the agent-server via
/// `POSTHOG_SIDECAR_CONFIG` (the same contract the Node sidecar consumes —
/// see `rust/crates/agent-server/src/adapter.rs`).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct GatewayEnv {
    #[serde(rename = "anthropicBaseUrl", default)]
    pub anthropic_base_url: String,
    #[serde(rename = "anthropicAuthToken", default)]
    pub anthropic_auth_token: String,
    #[serde(rename = "openaiBaseUrl", default)]
    pub openai_base_url: String,
    #[serde(rename = "openaiApiKey", default)]
    pub openai_api_key: String,
    #[serde(rename = "anthropicCustomHeaders", default)]
    pub anthropic_custom_headers: String,
    #[serde(rename = "posthogProjectId", default)]
    pub posthog_project_id: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SidecarConfig {
    #[serde(rename = "taskId", default)]
    pub task_id: String,
    #[serde(rename = "taskRunId", default)]
    pub task_run_id: String,
    #[serde(rename = "gatewayEnv", default)]
    pub gateway_env: Option<GatewayEnv>,
}

impl SidecarConfig {
    pub fn from_env() -> Self {
        std::env::var("POSTHOG_SIDECAR_CONFIG")
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }
}

/// Per-session spawn options resolved from ACP `session/new`.
#[derive(Debug, Clone)]
pub struct CliSessionOptions {
    pub cwd: String,
    pub session_id: String,
    /// `--resume <id>` instead of `--session-id` when set.
    pub resume: Option<String>,
    pub permission_mode: String,
    pub model: String,
    pub json_schema: Option<Value>,
    pub effort: Option<String>,
    /// Local plugin paths (`claudeCode.options.plugins[].path`).
    pub plugins: Vec<String>,
    /// Remote MCP servers from ACP session/new (ACP `McpServer[]` wire shape:
    /// `{type: http|sse, name, url, headers: [{name, value}]}`).
    pub mcp_servers: Vec<Value>,
}

/// The CLI expects mcp-config entries in the Claude Code shape. ACP http/sse
/// entries carry `headers` as a list of `{name, value}` pairs; the CLI wants
/// a map. The local-tools server passes as `{type: "sdk", name}` (the
/// `instance` field of `createSdkMcpServer` drops out of JSON the same way).
pub fn build_mcp_config(session: &CliSessionOptions) -> Value {
    let mut servers = serde_json::Map::new();
    for server in &session.mcp_servers {
        let Some(name) = server.get("name").and_then(Value::as_str) else {
            continue;
        };
        let kind = server.get("type").and_then(Value::as_str).unwrap_or("http");
        let url = server
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let mut headers = serde_json::Map::new();
        if let Some(list) = server.get("headers").and_then(Value::as_array) {
            for header in list {
                if let (Some(h_name), Some(h_value)) = (
                    header.get("name").and_then(Value::as_str),
                    header.get("value").and_then(Value::as_str),
                ) {
                    headers.insert(h_name.to_string(), json!(h_value));
                }
            }
        }
        let mut entry = serde_json::Map::new();
        entry.insert("type".into(), json!(kind));
        entry.insert("url".into(), json!(url));
        if !headers.is_empty() {
            entry.insert("headers".into(), Value::Object(headers));
        }
        servers.insert(name.to_string(), Value::Object(entry));
    }
    // The in-process local tools server, served over the control channel.
    servers.insert(
        LOCAL_TOOLS_MCP_NAME.to_string(),
        json!({ "type": "sdk", "name": LOCAL_TOOLS_MCP_NAME }),
    );
    json!({ "mcpServers": Value::Object(servers) })
}

/// Locate the Claude Code executable: `CLAUDE_CODE_EXECUTABLE` env override,
/// falling back to the SDK's vendored `cli.js` under the working directory's
/// `node_modules` (the sandbox layout: launch cwd is `/scripts`).
pub fn resolve_claude_executable() -> PathBuf {
    if let Ok(explicit) = std::env::var("CLAUDE_CODE_EXECUTABLE") {
        if !explicit.is_empty() {
            return PathBuf::from(explicit);
        }
    }
    PathBuf::from("./node_modules/@anthropic-ai/claude-agent-sdk/cli.js")
}

/// The legacy CLI ships as cli.js (run via node); native binaries have no
/// script extension — same check as the SDK transport.
fn is_script_executable(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()),
        Some("js") | Some("mjs") | Some("ts") | Some("tsx") | Some("jsx")
    )
}

/// Build the CLI argv (after the executable), mirroring the SDK transport's
/// arg construction for the option set the cloud driver uses.
pub fn build_cli_args(session: &CliSessionOptions) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--input-format".into(),
        "stream-json".into(),
    ];

    if let Some(effort) = &session.effort {
        args.extend(["--effort".into(), effort.clone()]);
    }
    args.extend(["--model".into(), session.model.clone()]);
    args.extend(["--betas".into(), "context-1m-2025-08-07".into()]);
    if let Some(schema) = &session.json_schema {
        args.extend(["--json-schema".into(), schema.to_string()]);
    }
    // canUseTool is always provided (permission relay), so the CLI must
    // delegate permission prompts over stdio.
    args.extend(["--permission-prompt-tool".into(), "stdio".into()]);

    if let Some(resume) = &session.resume {
        args.extend(["--resume".into(), resume.clone()]);
    }

    args.extend([
        "--tools".into(),
        "default".into(),
        "--mcp-config".into(),
        build_mcp_config(session).to_string(),
    ]);
    args.push("--setting-sources=user,project,local".into());
    args.extend(["--permission-mode".into(), session.permission_mode.clone()]);

    // `!IS_ROOT || !!process.env.IS_SANDBOX` — the sandbox image sets
    // IS_SANDBOX=1 so bypassPermissions works as root.
    let is_root = unsafe { libc::geteuid() } == 0;
    if !is_root || std::env::var("IS_SANDBOX").is_ok() {
        args.push("--allow-dangerously-skip-permissions".into());
    }

    if session.model != FALLBACK_MODEL {
        args.extend(["--fallback-model".into(), FALLBACK_MODEL.into()]);
    }
    args.push("--include-partial-messages".into());

    for plugin in &session.plugins {
        args.extend(["--plugin-dir".into(), plugin.clone()]);
    }

    if session.resume.is_none() {
        args.extend(["--session-id".into(), session.session_id.clone()]);
    }

    // extraArgs: { "replay-user-messages": "" }
    args.extend(["--replay-user-messages".into(), "".into()]);

    args
}

pub struct SpawnedCli {
    pub child: Child,
    pub stdin: ChildStdin,
    pub stdout: ChildStdout,
}

/// Spawn the CLI with the session args and the gateway environment.
/// Mirrors `buildEnvironment` in `session/options.ts` plus the SDK's env
/// fixups (CLAUDE_CODE_ENTRYPOINT, NODE_OPTIONS removal).
pub fn spawn_cli(
    session: &CliSessionOptions,
    gateway: Option<&GatewayEnv>,
) -> std::io::Result<SpawnedCli> {
    let executable = resolve_claude_executable();
    let args = build_cli_args(session);

    let mut command = if is_script_executable(&executable) {
        let mut c = Command::new("node");
        c.arg(&executable);
        c
    } else {
        Command::new(&executable)
    };
    command.args(&args);
    command.current_dir(&session.cwd);
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    // CLI diagnostics belong in /tmp/agent-server.log with ours.
    command.stderr(Stdio::inherit());

    command.env_remove("NODE_OPTIONS");
    if std::env::var("CLAUDE_CODE_ENTRYPOINT").is_err() {
        command.env("CLAUDE_CODE_ENTRYPOINT", "sdk-ts");
    }

    // Custom headers: gateway-provided task attribution lines, the per-team
    // attribution header, and the Bedrock fallback marker.
    let mut header_lines: Vec<String> = Vec::new();
    if let Some(gateway) = gateway {
        if !gateway.anthropic_custom_headers.is_empty() {
            header_lines.push(gateway.anthropic_custom_headers.clone());
        }
        let project_id = if gateway.posthog_project_id.is_empty() {
            std::env::var("POSTHOG_PROJECT_ID").unwrap_or_default()
        } else {
            gateway.posthog_project_id.clone()
        };
        if !project_id.is_empty() {
            header_lines.push(format!("x-posthog-property-team_id: {project_id}"));
        }
    }
    header_lines.push("x-posthog-use-bedrock-fallback: true".to_string());
    command.env("ANTHROPIC_CUSTOM_HEADERS", header_lines.join("\n"));

    if let Some(gateway) = gateway {
        if !gateway.anthropic_base_url.is_empty() {
            command.env("ANTHROPIC_BASE_URL", &gateway.anthropic_base_url);
        }
        if !gateway.anthropic_auth_token.is_empty() {
            command.env("ANTHROPIC_AUTH_TOKEN", &gateway.anthropic_auth_token);
            command.env("ANTHROPIC_API_KEY", &gateway.anthropic_auth_token);
        }
        if !gateway.openai_base_url.is_empty() {
            command.env("OPENAI_BASE_URL", &gateway.openai_base_url);
        }
        if !gateway.openai_api_key.is_empty() {
            command.env("OPENAI_API_KEY", &gateway.openai_api_key);
        }
    }
    command.env("CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL", "true");
    // Offload all MCP tools by default (ToolSearch).
    command.env("ENABLE_TOOL_SEARCH", "auto:0");
    // Idle state as end-of-turn signal (required for SDK 0.2.114+).
    command.env("CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS", "1");
    command.kill_on_drop(true);

    let mut child = command.spawn()?;
    let stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    tracing::info!(
        executable = %executable.display(),
        pid = child.id(),
        "Spawned Claude Code CLI"
    );
    Ok(SpawnedCli {
        child,
        stdin,
        stdout,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session() -> CliSessionOptions {
        CliSessionOptions {
            cwd: "/tmp".into(),
            session_id: "sess-1".into(),
            resume: None,
            permission_mode: "bypassPermissions".into(),
            model: DEFAULT_MODEL.into(),
            json_schema: None,
            effort: None,
            plugins: Vec::new(),
            mcp_servers: vec![json!({
                "type": "http",
                "name": "posthog",
                "url": "https://mcp.posthog.com/mcp",
                "headers": [{ "name": "Authorization", "value": "Bearer x" }],
            })],
        }
    }

    #[test]
    fn args_carry_sdk_contract() {
        let args = build_cli_args(&session());
        let joined = args.join(" ");
        assert!(
            joined.starts_with("--output-format stream-json --verbose --input-format stream-json")
        );
        assert!(joined.contains("--permission-prompt-tool stdio"));
        assert!(joined.contains("--model opus"));
        assert!(joined.contains("--fallback-model claude-opus-4-8"));
        assert!(joined.contains("--betas context-1m-2025-08-07"));
        assert!(joined.contains("--permission-mode bypassPermissions"));
        assert!(joined.contains("--include-partial-messages"));
        assert!(joined.contains("--session-id sess-1"));
        assert!(joined.contains("--setting-sources=user,project,local"));
        assert!(!joined.contains("--resume"));
        // --replay-user-messages takes an empty value argument.
        let idx = args
            .iter()
            .position(|a| a == "--replay-user-messages")
            .unwrap();
        assert_eq!(args[idx + 1], "");
    }

    #[test]
    fn resume_replaces_session_id() {
        let mut s = session();
        s.resume = Some("old-sess".into());
        let args = build_cli_args(&s).join(" ");
        assert!(args.contains("--resume old-sess"));
        assert!(!args.contains("--session-id"));
    }

    #[test]
    fn mcp_config_includes_sdk_local_tools() {
        let config = build_mcp_config(&session());
        assert_eq!(
            config.pointer("/mcpServers/posthog-code-tools/type"),
            Some(&json!("sdk"))
        );
        assert_eq!(
            config.pointer("/mcpServers/posthog/headers/Authorization"),
            Some(&json!("Bearer x"))
        );
        assert_eq!(
            config.pointer("/mcpServers/posthog/type"),
            Some(&json!("http"))
        );
    }
}
