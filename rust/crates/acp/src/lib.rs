//! JSON-RPC 2.0 peer speaking the Agent Client Protocol (ACP) over
//! newline-delimited JSON streams.
//!
//! This is the client-side counterpart of `@agentclientprotocol/sdk`'s
//! `ClientSideConnection`: it drives an ACP agent (a subprocess speaking ACP
//! on stdio) by sending requests (`initialize`, `session/new`,
//! `session/prompt`, ...) and dispatching the agent's incoming requests
//! (`session/request_permission`) and notifications (`session/update`,
//! `_posthog/*`) to a handler.
//!
//! Every raw line that crosses the peer — both directions — is surfaced
//! through a tap callback so the host can broadcast/persist traffic without
//! re-parsing (the parse-once design of the Rust agent-server).

pub mod peer;

pub use peer::{Direction, IncomingHandler, LineTap, Peer, PeerHandle, RpcError};

/// ACP protocol version spoken by this crate (matches the version returned by
/// the TS adapters in posthog/code — see `claude-agent.ts` `initialize()`).
pub const PROTOCOL_VERSION: u16 = 1;

/// ACP method names used by the agent-server (client → agent).
pub mod methods {
    pub const INITIALIZE: &str = "initialize";
    pub const SESSION_NEW: &str = "session/new";
    pub const SESSION_LOAD: &str = "session/load";
    pub const SESSION_PROMPT: &str = "session/prompt";
    /// Notification, not a request.
    pub const SESSION_CANCEL: &str = "session/cancel";
    pub const SESSION_SET_MODE: &str = "session/set_mode";
    pub const SESSION_SET_CONFIG_OPTION: &str = "session/set_config_option";
}

/// ACP method names the agent calls on us (agent → client).
pub mod client_methods {
    pub const SESSION_UPDATE: &str = "session/update";
    pub const SESSION_REQUEST_PERMISSION: &str = "session/request_permission";
    pub const FS_READ_TEXT_FILE: &str = "fs/read_text_file";
    pub const FS_WRITE_TEXT_FILE: &str = "fs/write_text_file";
}

/// PostHog ACP extension methods and notifications (`_posthog/` namespace).
/// Mirrors `packages/agent/src/acp-extensions.ts` — keep in sync.
pub mod ext {
    pub const BRANCH_CREATED: &str = "_posthog/branch_created";
    pub const RUN_STARTED: &str = "_posthog/run_started";
    pub const TASK_COMPLETE: &str = "_posthog/task_complete";
    pub const TURN_COMPLETE: &str = "_posthog/turn_complete";
    pub const BACKGROUND_TURN_COMPLETE: &str = "_posthog/background_turn_complete";
    pub const ERROR: &str = "_posthog/error";
    pub const CONSOLE: &str = "_posthog/console";
    pub const SDK_SESSION: &str = "_posthog/sdk_session";
    pub const GIT_CHECKPOINT: &str = "_posthog/git_checkpoint";
    pub const MODE_CHANGE: &str = "_posthog/mode_change";
    pub const SESSION_RESUME: &str = "_posthog/session/resume";
    pub const USER_MESSAGE: &str = "_posthog/user_message";
    pub const CANCEL: &str = "_posthog/cancel";
    pub const CLOSE: &str = "_posthog/close";
    pub const STATUS: &str = "_posthog/status";
    pub const PROGRESS: &str = "_posthog/progress";
    pub const TASK_NOTIFICATION: &str = "_posthog/task_notification";
    pub const COMPACT_BOUNDARY: &str = "_posthog/compact_boundary";
    pub const USAGE_UPDATE: &str = "_posthog/usage_update";
    pub const RESOURCES_USED: &str = "_posthog/resources_used";
    pub const PERMISSION_RESPONSE: &str = "_posthog/permission_response";
    pub const PERMISSION_REQUEST: &str = "_posthog/permission_request";
    pub const PERMISSION_RESOLVED: &str = "_posthog/permission_resolved";
    pub const STRUCTURED_OUTPUT: &str = "_posthog/structured_output";
    pub const REFRESH_SESSION: &str = "_posthog/refresh_session";
}
