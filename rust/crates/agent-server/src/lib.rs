//! PostHog cloud agent-server, Rust implementation.
//!
//! Phase 1 of the Rust rewrite (see `rust/README.md`): this crate owns the
//! HTTP/SSE/JWT surface, the durable event-ingest stream, session log
//! persistence, the PostHog API client, and session lifecycle orchestration.
//! The agent itself runs as a subprocess speaking ACP over stdio — the
//! `codex app-server` native binary, the Node `@posthog/agent` ACP sidecar
//! (`posthog-acp-claude`), or the mock agent used in tests.
//!
//! The HTTP surface, wire shapes, and CLI flags are contract-compatible with
//! the TypeScript `agent-server` in `packages/agent/src/server/` — Django and
//! clients cannot tell the implementations apart. Mirrored TS sources are
//! referenced from each module.

pub mod adapter;
pub mod bus;
pub mod client;
pub mod command;
pub mod config;
pub mod error_class;
pub mod gateway;
pub mod http;
pub mod ingest;
pub mod jwt;
pub mod log_writer;
pub mod posthog_api;
pub mod server;
pub mod system_prompt;

/// Mirrors `packageJson.version` reporting in the TS server; the Rust build
/// stamps its own crate version plus a `-rs` marker so log lines and the
/// `_posthog/run_started.agentVersion` capability gate can tell the
/// implementations apart while staying semver-parseable.
pub fn agent_version() -> String {
    format!("{}-rs", env!("CARGO_PKG_VERSION"))
}

/// `new Date().toISOString()` equivalent — millisecond precision, `Z` suffix.
pub fn iso_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
