//! Shared PostHog agent tooling used by both native drivers.
//!
//! - `signed_git` — full port of `@posthog/git/signed-commit`
//!   (createCommitOnBranch commits, rewrites, merges, with every guard)
//! - `gh` — `gh` CLI execution with transient-failure retry
//! - `artefacts` — best-effort commit-artefact reporting
//! - `mcp` — the `posthog-code-tools` MCP server answering JSON-RPC
//!   `initialize`/`tools/list`/`tools/call`. The Claude driver serves it over
//!   the CLI's `mcp_message` control channel; the codex driver serves it as a
//!   stdio MCP subprocess.

pub mod artefacts;
pub mod gh;
pub mod mcp;
pub mod signed_git;
