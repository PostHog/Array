//! Native ACP driver for the codex app-server.
//!
//! Completes the Rust rewrite's phase 2 for codex runs (see
//! `rust/README.md`): this crate replaces the Node ACP sidecar by porting
//! `packages/agent/src/adapters/codex-app-server/` — the translation layer
//! between ACP and the native `codex app-server` JSON-RPC protocol
//! (newline-delimited JSON without the `"jsonrpc"` header):
//!
//! ```text
//! agent-server (Rust) ── ACP/stdio ──> codex-acp-driver (this crate)
//!                                        │ app-server JSON-RPC (ndjson)
//!                                        └──> codex app-server (native binary)
//! ```
//!
//! The signed-git local tools are served to codex as a stdio MCP subprocess:
//! the driver binary re-invokes itself with `--local-tools-mcp`, mirroring
//! the TS `local-tools-mcp-server.js` child.

pub mod driver;
pub mod input;
pub mod local_tools_stdio;
pub mod mapping;
pub mod modes;
pub mod rpc;
pub mod sidecar;
pub mod spawn;
pub mod structured;
pub mod turns;
pub mod usage;

pub fn driver_version() -> String {
    format!("{}-rs", env!("CARGO_PKG_VERSION"))
}
