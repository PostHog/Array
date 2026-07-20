//! ACP agent subprocess management.
//!
//! Phase 1 of the Rust rewrite runs every agent as a subprocess speaking ACP
//! over stdio: the Node `posthog-acp-claude` sidecar (the existing
//! `ClaudeAcpAgent` wired to stdin/stdout), or `mock-acp-agent` in tests.
//! Phase 2 replaces the Node sidecar with a native Claude Code driver crate;
//! the interface here doesn't change.

use serde_json::json;
use std::process::Stdio;
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

use crate::config::ServerConfig;
use crate::gateway::GatewayEnv;

pub struct SpawnedAdapter {
    pub child: Child,
    pub stdin: ChildStdin,
    pub stdout: ChildStdout,
}

/// Configuration handed to the sidecar via `POSTHOG_SIDECAR_CONFIG`
/// (consumed by `packages/agent/src/server/acp-stdio-bin.ts`).
pub struct SidecarContext<'a> {
    pub config: &'a ServerConfig,
    pub gateway_env: &'a GatewayEnv,
}

pub fn spawn_adapter(ctx: &SidecarContext) -> std::io::Result<SpawnedAdapter> {
    let config = ctx.config;
    let sidecar_config = json!({
        "taskId": config.task_id,
        "taskRunId": config.run_id,
        "deviceType": "cloud",
        "adapter": config.runtime_adapter.as_str(),
        "gatewayEnv": ctx.gateway_env,
        "posthogApiConfig": {
            "apiUrl": config.api_url,
            "projectId": config.project_id,
        },
    });

    let mut command = Command::new("sh");
    command
        .arg("-c")
        .arg(&config.adapter_cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // The sandbox launch script redirects our stderr to
        // /tmp/agent-server.log; the sidecar's diagnostics belong there too.
        .stderr(Stdio::inherit())
        .env("POSTHOG_SIDECAR_CONFIG", sidecar_config.to_string())
        // Server-level constants spawned tools rely on (mirrors
        // `configureEnvironment`'s process.env writes in the TS server).
        .env("POSTHOG_API_KEY", &config.api_key)
        .env("POSTHOG_API_URL", &config.api_url)
        .env("POSTHOG_API_HOST", &config.api_url)
        .env("POSTHOG_AUTH_HEADER", format!("Bearer {}", config.api_key))
        .env("POSTHOG_PROJECT_ID", config.project_id.to_string())
        .kill_on_drop(true);

    let mut child = command.spawn()?;
    let stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");

    tracing::info!(cmd = %config.adapter_cmd, pid = child.id(), "Spawned ACP adapter subprocess");
    Ok(SpawnedAdapter {
        child,
        stdin,
        stdout,
    })
}
