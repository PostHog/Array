//! `claude-acp-driver`: the native ACP-over-stdio agent for Claude cloud
//! runs. Launched by the Rust agent-server in place of the Node sidecar
//! (`POSTHOG_ACP_ADAPTER_CMD=claude-acp-driver`); stdin/stdout carry ACP,
//! stderr carries diagnostics (redirected to /tmp/agent-server.log by the
//! sandbox launch script).

use posthog_claude_driver::cli::SidecarConfig;
use posthog_claude_driver::driver::Driver;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    tracing::info!(
        version = %posthog_claude_driver::driver_version(),
        "Starting Claude ACP driver"
    );

    let driver = Driver::new(SidecarConfig::from_env());
    driver.run(tokio::io::stdin(), tokio::io::stdout()).await;
    tracing::info!("ACP connection closed; exiting");
}
