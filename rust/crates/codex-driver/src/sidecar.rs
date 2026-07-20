//! `POSTHOG_SIDECAR_CONFIG` for codex runs — the same JSON contract the Node
//! sidecar consumes (`server/acp-stdio-bin.ts`), narrowed to the fields the
//! codex driver uses: the gateway's OpenAI base URL and the per-run
//! `codexOptions` the agent-server passes (cwd, model, reasoning effort).

use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
pub struct GatewayEnv {
    #[serde(rename = "openaiBaseUrl", default)]
    pub openai_base_url: String,
    #[serde(rename = "openaiApiKey", default)]
    pub openai_api_key: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct CodexOptions {
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(rename = "reasoningEffort", default)]
    pub reasoning_effort: Option<String>,
    #[serde(rename = "developerInstructions", default)]
    pub developer_instructions: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SidecarConfig {
    #[serde(rename = "taskId", default)]
    pub task_id: String,
    #[serde(rename = "taskRunId", default)]
    pub task_run_id: String,
    #[serde(rename = "gatewayEnv", default)]
    pub gateway_env: Option<GatewayEnv>,
    #[serde(rename = "codexOptions", default)]
    pub codex_options: Option<CodexOptions>,
}

impl SidecarConfig {
    pub fn from_env() -> Self {
        std::env::var("POSTHOG_SIDECAR_CONFIG")
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    /// The gateway key the app-server authenticates with
    /// (`POSTHOG_GATEWAY_API_KEY`). Mirrors the sidecar: the PostHog API key
    /// from the server-level env, not the gateway env.
    pub fn gateway_api_key(&self) -> Option<String> {
        std::env::var("POSTHOG_API_KEY")
            .ok()
            .or_else(|| std::env::var("POSTHOG_PERSONAL_API_KEY").ok())
            .filter(|key| !key.is_empty())
    }
}
