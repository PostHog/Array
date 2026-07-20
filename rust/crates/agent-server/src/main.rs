//! `agent-server` binary — CLI-compatible with the TS `agent-server` from
//! `@posthog/agent` (see `packages/agent/src/server/bin.ts`).

use std::sync::Arc;

use clap::Parser;
use posthog_agent_server::config::{Cli, ServerConfig};
use posthog_agent_server::http::build_router;
use posthog_agent_server::server::AgentServer;

fn main() {
    let cli = Cli::parse();

    let config = match ServerConfig::from_cli_and_env(cli) {
        Ok(config) => config,
        Err(err) => {
            eprintln!("error: {err}");
            std::process::exit(1);
        }
    };

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
    runtime.block_on(async_main(config));
}

async fn async_main(config: ServerConfig) {
    let port = config.port;
    let server = AgentServer::new(config);

    let listener = match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("error: failed to bind port {port}: {err}");
            std::process::exit(1);
        }
    };
    tracing::debug!(port, "HTTP server listening");

    let router = build_router(Arc::clone(&server));
    let http = tokio::spawn(async move {
        if let Err(err) = axum::serve(listener, router).await {
            tracing::error!(error = %err, "HTTP server failed");
        }
    });

    // Session init failures at boot are fatal: mark the run failed (bounded
    // at 5s, like the TS uncaughtException handler) instead of stalling
    // silently until the workflow inactivity timeout.
    if let Err(err) = server.auto_initialize_session().await {
        let deadline = std::time::Duration::from_secs(5);
        let _ = tokio::time::timeout(deadline, server.report_fatal_error(&err.to_string())).await;
        std::process::exit(1);
    }

    let mut sigterm =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("sigterm");
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = sigterm.recv() => {}
        _ = http => {}
    }

    server.stop().await;
    std::process::exit(0);
}
