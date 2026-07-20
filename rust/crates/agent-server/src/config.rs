//! CLI and environment configuration.
//!
//! Flag names, env var names, defaults, and validation error messages mirror
//! `packages/agent/src/server/bin.ts` exactly — Django builds the launch
//! command (`_build_agent_server_command` in posthog/posthog) against that
//! contract and must not be able to tell the implementations apart.

use clap::Parser;
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentMode {
    Interactive,
    Background,
}

impl AgentMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            AgentMode::Interactive => "interactive",
            AgentMode::Background => "background",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeAdapter {
    Claude,
    Codex,
}

impl RuntimeAdapter {
    pub fn as_str(&self) -> &'static str {
        match self {
            RuntimeAdapter::Claude => "claude",
            RuntimeAdapter::Codex => "codex",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct HttpHeader {
    pub name: String,
    pub value: String,
}

/// Remote MCP server config (`mcpServersSchema` in schemas.ts).
#[derive(Debug, Clone, Deserialize)]
pub struct RemoteMcpServer {
    #[serde(rename = "type")]
    pub kind: McpServerKind,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<HttpHeader>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpServerKind {
    Http,
    Sse,
}

/// `claudeCodeConfigSchema` in schemas.ts.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ClaudeCodeConfig {
    #[serde(rename = "systemPrompt")]
    pub system_prompt: Option<serde_json::Value>,
    pub plugins: Option<Vec<serde_json::Value>>,
}

#[derive(Parser, Debug)]
#[command(
    name = "agent-server",
    about = "PostHog cloud agent server - runs in sandbox environments"
)]
pub struct Cli {
    /// HTTP server port
    #[arg(long, default_value = "3001")]
    pub port: u16,

    /// Execution mode: interactive or background
    #[arg(long, default_value = "interactive")]
    pub mode: String,

    /// Path to the repository
    #[arg(long = "repositoryPath")]
    pub repository_path: Option<String>,

    /// Sentinel file; session creation blocks until it exists (set while cloning concurrently)
    #[arg(long = "repoReadyFile")]
    pub repo_ready_file: Option<String>,

    /// Task ID
    #[arg(long = "taskId", required = true)]
    pub task_id: String,

    /// Task run ID
    #[arg(long = "runId", required = true)]
    pub run_id: String,

    /// MCP servers config as JSON array (ACP McpServer[] format)
    #[arg(long = "mcpServers")]
    pub mcp_servers: Option<String>,

    /// Whether this run may publish changes
    #[arg(long = "createPr")]
    pub create_pr: Option<String>,

    /// Whether this run should push and open a draft PR on completion without an explicit ask
    #[arg(long = "autoPublish")]
    pub auto_publish: Option<String>,

    /// Base branch for PR creation
    #[arg(long = "baseBranch")]
    pub base_branch: Option<String>,

    /// Claude Code config as JSON (systemPrompt, systemPromptAppend, plugins)
    #[arg(long = "claudeCodeConfig")]
    pub claude_code_config: Option<String>,

    /// Comma-separated list of domains allowed for web tools (WebFetch, WebSearch)
    #[arg(long = "allowedDomains")]
    pub allowed_domains: Option<String>,

    /// Command used to spawn the ACP agent subprocess (Rust server only).
    /// Overrides POSTHOG_ACP_ADAPTER_CMD; run through `sh -c`.
    #[arg(long = "adapterCmd")]
    pub adapter_cmd: Option<String>,
}

/// Fully resolved server configuration (`AgentServerConfig` in types.ts).
#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub port: u16,
    pub repository_path: Option<String>,
    pub repo_ready_file: Option<String>,
    pub api_url: String,
    pub api_key: String,
    pub project_id: i64,
    pub jwt_public_key: String,
    pub event_ingest_token: Option<String>,
    pub event_ingest_base_url: Option<String>,
    pub event_ingest_stream_window_ms: Option<u64>,
    pub event_ingest_keep_stream_open: Option<bool>,
    pub mode: AgentMode,
    pub task_id: String,
    pub run_id: String,
    pub create_pr: Option<bool>,
    pub auto_publish: Option<bool>,
    pub mcp_servers: Vec<serde_json::Value>,
    pub base_branch: Option<String>,
    pub claude_code: Option<ClaudeCodeConfig>,
    pub allowed_domains: Option<Vec<String>>,
    pub runtime_adapter: RuntimeAdapter,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    /// Shell command that spawns the ACP agent subprocess.
    pub adapter_cmd: String,
    pub resume_run_id: Option<String>,
    pub interaction_origin: Option<String>,
    pub llm_gateway_url_override: Option<String>,
    pub hostname: Option<String>,
}

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct ConfigError(pub String);

fn required_env(name: &str, message: &str) -> Result<String, ConfigError> {
    match std::env::var(name) {
        Ok(value) if !value.is_empty() => Ok(value),
        _ => Err(ConfigError(format!(
            "Environment validation failed:\n  - {message}"
        ))),
    }
}

fn parse_boolean_option(raw: &Option<String>, flag: &str) -> Result<Option<bool>, ConfigError> {
    match raw.as_deref() {
        None => Ok(None),
        Some("true") => Ok(Some(true)),
        Some("false") => Ok(Some(false)),
        Some(_) => Err(ConfigError(format!(
            "{flag} must be either \"true\" or \"false\""
        ))),
    }
}

/// Default adapter command: the ACP-over-stdio sidecar shipped with
/// `@posthog/agent` (bin `posthog-acp-claude`); Django installs it into
/// /scripts in the sandbox image. The adapter kind (claude vs codex) reaches
/// the sidecar via `POSTHOG_SIDECAR_CONFIG`, not argv.
const DEFAULT_ADAPTER_CMD: &str = "./node_modules/.bin/posthog-acp-claude";

impl ServerConfig {
    pub fn from_cli_and_env(cli: Cli) -> Result<Self, ConfigError> {
        let jwt_public_key = required_env(
            "JWT_PUBLIC_KEY",
            "JWT_PUBLIC_KEY is required for authenticating client connections",
        )?;
        let api_url = required_env(
            "POSTHOG_API_URL",
            "POSTHOG_API_URL is required for LLM gateway communication",
        )?;
        let api_key = required_env(
            "POSTHOG_PERSONAL_API_KEY",
            "POSTHOG_PERSONAL_API_KEY is required for authenticating with PostHog services",
        )?;
        let project_id_raw = required_env(
            "POSTHOG_PROJECT_ID",
            "POSTHOG_PROJECT_ID is required for routing requests to the correct project",
        )?;
        let project_id: i64 = project_id_raw.parse().map_err(|_| {
            ConfigError(
                "Environment validation failed:\n  - POSTHOG_PROJECT_ID must be a numeric string"
                    .to_string(),
            )
        })?;

        let runtime_adapter = match std::env::var("POSTHOG_CODE_RUNTIME_ADAPTER")
            .ok()
            .as_deref()
        {
            Some("codex") => RuntimeAdapter::Codex,
            _ => RuntimeAdapter::Claude,
        };

        let mode = if cli.mode == "background" {
            AgentMode::Background
        } else {
            AgentMode::Interactive
        };

        let create_pr = parse_boolean_option(&cli.create_pr, "--createPr")?;
        let auto_publish = parse_boolean_option(&cli.auto_publish, "--autoPublish")?;

        let mcp_servers: Vec<serde_json::Value> = match &cli.mcp_servers {
            None => Vec::new(),
            Some(raw) => {
                let parsed: serde_json::Value = serde_json::from_str(raw)
                    .map_err(|_| ConfigError("--mcpServers must be valid JSON".to_string()))?;
                // Validate the shape, then keep the raw values: they are
                // passed through to the agent verbatim in session/new.
                let servers: Vec<RemoteMcpServer> = serde_json::from_value(parsed.clone())
                    .map_err(|err| {
                        ConfigError(format!("--mcpServers validation failed:\n  - {err}"))
                    })?;
                for server in &servers {
                    if server.name.is_empty() {
                        return Err(ConfigError(
                            "--mcpServers validation failed:\n  - name: MCP server name is required"
                                .to_string(),
                        ));
                    }
                    if !server.url.starts_with("http://") && !server.url.starts_with("https://") {
                        return Err(ConfigError(
                            "--mcpServers validation failed:\n  - url: MCP server url must be a valid URL"
                                .to_string(),
                        ));
                    }
                }
                parsed.as_array().cloned().unwrap_or_default()
            }
        };

        let claude_code: Option<ClaudeCodeConfig> = match &cli.claude_code_config {
            None => None,
            Some(raw) => {
                let parsed: ClaudeCodeConfig = serde_json::from_str(raw).map_err(|_| {
                    ConfigError("--claudeCodeConfig must be valid JSON".to_string())
                })?;
                Some(parsed)
            }
        };

        let allowed_domains = cli.allowed_domains.as_ref().map(|raw| {
            raw.split(',')
                .map(str::trim)
                .filter(|d| !d.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        });

        let event_ingest_stream_window_ms = match std::env::var(
            "POSTHOG_TASK_RUN_EVENT_INGEST_STREAM_WINDOW_MS",
        )
        .ok()
        {
            None => None,
            Some(raw) => {
                if !raw.chars().all(|c| c.is_ascii_digit()) || raw.starts_with('0') {
                    return Err(ConfigError(
                            "Environment validation failed:\n  - POSTHOG_TASK_RUN_EVENT_INGEST_STREAM_WINDOW_MS must be a positive integer".to_string(),
                        ));
                }
                Some(raw.parse::<u64>().map_err(|_| {
                        ConfigError(
                            "Environment validation failed:\n  - POSTHOG_TASK_RUN_EVENT_INGEST_STREAM_WINDOW_MS must be a positive integer".to_string(),
                        )
                    })?)
            }
        };

        let event_ingest_keep_stream_open =
            match std::env::var("POSTHOG_TASK_RUN_EVENT_INGEST_KEEP_STREAM_OPEN").ok().as_deref() {
                None => None,
                Some("true") => Some(true),
                Some("false") => Some(false),
                Some(_) => {
                    return Err(ConfigError(
                        "Environment validation failed:\n  - POSTHOG_TASK_RUN_EVENT_INGEST_KEEP_STREAM_OPEN must be \"true\" or \"false\"".to_string(),
                    ))
                }
            };

        // POSTHOG_CLAUDE_ADAPTER_CMD / POSTHOG_CODEX_ADAPTER_CMD apply only to
        // runs of the matching adapter (the native driver rollout switches);
        // other runs keep the Node sidecar even when they are set, so Django
        // can export them unconditionally.
        let adapter_specific_cmd = match runtime_adapter {
            RuntimeAdapter::Claude => std::env::var("POSTHOG_CLAUDE_ADAPTER_CMD").ok(),
            RuntimeAdapter::Codex => std::env::var("POSTHOG_CODEX_ADAPTER_CMD").ok(),
        }
        .filter(|cmd| !cmd.trim().is_empty());
        let adapter_cmd = cli
            .adapter_cmd
            .or_else(|| std::env::var("POSTHOG_ACP_ADAPTER_CMD").ok())
            .or(adapter_specific_cmd)
            .unwrap_or_else(|| DEFAULT_ADAPTER_CMD.to_string());

        let interaction_origin = std::env::var("POSTHOG_CODE_INTERACTION_ORIGIN")
            .ok()
            .or_else(|| std::env::var("CODE_INTERACTION_ORIGIN").ok())
            .or_else(|| std::env::var("TWIG_INTERACTION_ORIGIN").ok());

        Ok(ServerConfig {
            port: cli.port,
            repository_path: cli.repository_path,
            repo_ready_file: cli.repo_ready_file,
            api_url,
            api_key,
            project_id,
            jwt_public_key,
            event_ingest_token: std::env::var("POSTHOG_TASK_RUN_EVENT_INGEST_TOKEN")
                .ok()
                .filter(|v| !v.is_empty()),
            event_ingest_base_url: std::env::var("POSTHOG_TASK_RUN_EVENT_INGEST_URL")
                .ok()
                .filter(|v| !v.is_empty()),
            event_ingest_stream_window_ms,
            event_ingest_keep_stream_open,
            mode,
            task_id: cli.task_id,
            run_id: cli.run_id,
            create_pr,
            auto_publish,
            mcp_servers,
            base_branch: cli.base_branch,
            claude_code,
            allowed_domains,
            runtime_adapter,
            model: std::env::var("POSTHOG_CODE_MODEL")
                .ok()
                .filter(|v| !v.is_empty()),
            reasoning_effort: std::env::var("POSTHOG_CODE_REASONING_EFFORT")
                .ok()
                .filter(|v| !v.is_empty()),
            adapter_cmd,
            resume_run_id: std::env::var("POSTHOG_RESUME_RUN_ID")
                .ok()
                .filter(|v| !v.is_empty()),
            interaction_origin,
            llm_gateway_url_override: std::env::var("LLM_GATEWAY_URL")
                .ok()
                .filter(|v| !v.is_empty()),
            hostname: std::env::var("HOSTNAME").ok().filter(|v| !v.is_empty()),
        })
    }
}
