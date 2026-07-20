//! Native ACP driver for the Claude Code CLI.
//!
//! Phase 2 of the Rust agent-server rewrite (see `rust/README.md`): this
//! crate replaces the Node ACP sidecar (`posthog-acp-claude`) for Claude
//! runs. It speaks ACP over stdio to the Rust agent-server on one side, and
//! the Claude Code CLI's stream-json control protocol on the other — the
//! same wire protocol `@anthropic-ai/claude-agent-sdk` speaks, extracted
//! from the SDK's transport (`sdk.mjs`, v0.3.197):
//!
//! ```text
//! agent-server (Rust) ── ACP/stdio ──> claude-acp-driver (this crate)
//!                                        │ stream-json + control protocol
//!                                        └──> node cli.js (Claude Code CLI)
//! ```
//!
//! The signed-git local tools (`posthog-code-tools`) are served to the CLI
//! in-process over the `mcp_message` control channel, exactly like the SDK's
//! `createSdkMcpServer` servers.
//!
//! Kept-compatible contracts (mirror sources in `packages/agent/src/`):
//! - ACP surface: `adapters/claude/claude-agent.ts` (initialize/new/prompt/cancel)
//! - SDK→ACP conversion: `adapters/claude/conversion/*`
//! - Signed-git tools: `adapters/signed-commit-shared.ts` + `@posthog/git/signed-commit`

pub mod cli;
pub mod convert;
pub mod driver;
pub mod error_class;
pub mod instructions;
pub mod prompt;
pub mod transport;

pub fn driver_version() -> String {
    format!("{}-rs", env!("CARGO_PKG_VERSION"))
}
