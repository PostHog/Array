//! `codex-acp-driver`: the native ACP-over-stdio agent for codex cloud runs,
//! launched by the Rust agent-server in place of the Node sidecar
//! (`POSTHOG_CODEX_ADAPTER_CMD=codex-acp-driver`). With `--local-tools-mcp`
//! it instead serves the `posthog-code-tools` stdio MCP server that the codex
//! app-server spawns as a subprocess.

use posthog_codex_driver::driver::Driver;
use posthog_codex_driver::sidecar::SidecarConfig;

#[tokio::main]
async fn main() {
    let local_tools_mode = std::env::args().any(|arg| arg == "--local-tools-mcp");

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    if local_tools_mode {
        posthog_codex_driver::local_tools_stdio::run().await;
        return;
    }

    tracing::info!(
        version = %posthog_codex_driver::driver_version(),
        "Starting codex ACP driver"
    );
    let driver = Driver::new(SidecarConfig::from_env());
    driver.run(tokio::io::stdin(), tokio::io::stdout()).await;
    tracing::info!("ACP connection closed; exiting");
}
