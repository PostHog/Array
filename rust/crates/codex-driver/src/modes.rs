//! Session config + mode synthesis. Port of `session-config.ts` +
//! `models.ts` + the `CODEX_MODE_PRESETS` literals from `@posthog/shared`:
//! the app-server has no "mode" RPC (a thread is configured by
//! `approvalPolicy` + sandbox), so modes are synthesized here and applied
//! per-turn on `turn/start`.

use serde_json::{json, Value};

/// `DEFAULT_CODEX_MODEL` from `gateway-models.ts`.
pub const DEFAULT_CODEX_MODEL: &str = "gpt-5.5";
pub const DEFAULT_MODE: &str = "auto";

pub struct CodexMode {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    /// codex AskForApproval the mode maps to, applied per-turn on turn/start.
    pub approval_policy: &'static str,
    /// codex's named permission profile (`activePermissionProfile.extends`);
    /// None keeps the spawned default. Skipped on cloud, where a non-danger
    /// sandbox would re-engage the unavailable linux-sandbox and panic.
    pub permission_profile: Option<&'static str>,
    /// Per-turn sandbox override; None keeps the spawned editable sandbox.
    pub sandbox_read_only: bool,
    /// "plan" unlocks plan proposals + request_user_input; else "default".
    pub collaboration_mode: &'static str,
}

pub const CODEX_MODES: [CodexMode; 4] = [
    CodexMode {
        id: "plan",
        name: "Plan",
        description: "Plan first — inspect and propose; makes no changes",
        approval_policy: "on-request",
        permission_profile: Some(":read-only"),
        sandbox_read_only: true,
        collaboration_mode: "plan",
    },
    CodexMode {
        id: "read-only",
        name: "Read only",
        description: "Read-only — can inspect but not modify files",
        approval_policy: "untrusted",
        permission_profile: Some(":read-only"),
        sandbox_read_only: true,
        collaboration_mode: "default",
    },
    CodexMode {
        id: "auto",
        name: "Auto",
        description: "Edits the workspace; asks before risky operations",
        approval_policy: "on-request",
        permission_profile: None,
        sandbox_read_only: false,
        collaboration_mode: "default",
    },
    CodexMode {
        id: "full-access",
        name: "Full access",
        description: "Auto-approves all operations",
        approval_policy: "never",
        permission_profile: None,
        sandbox_read_only: false,
        collaboration_mode: "default",
    },
];

fn mode_by_id(id: &str) -> Option<&'static CodexMode> {
    CODEX_MODES.iter().find(|m| m.id == id)
}

/// Resolve the host's initial `_meta.permissionMode` to a codex mode. A
/// recognized mode is honored; anything else (e.g. "bypassPermissions")
/// falls back to the default.
pub fn resolve_initial_mode(permission_mode: Option<&str>) -> &'static str {
    permission_mode
        .and_then(mode_by_id)
        .map(|m| m.id)
        .unwrap_or(DEFAULT_MODE)
}

/// Codex's standard reasoning efforts; used when model/list doesn't expose them.
const DEFAULT_EFFORTS: [&str; 3] = ["low", "medium", "high"];

fn humanize_effort(effort: &str) -> String {
    match effort {
        "low" => "Low".to_string(),
        "medium" => "Medium".to_string(),
        "high" => "High".to_string(),
        "xhigh" => "Extra High".to_string(),
        "max" => "Max".to_string(),
        other => other.to_string(),
    }
}

/// OpenAI's `reasoning_effort` exposes "extra high" only on the gpt-5.5
/// family, matching what the Codex app offers.
fn supports_xhigh_effort(model_id: &str) -> bool {
    model_id.to_lowercase().contains("gpt-5.5")
}

fn default_efforts_for(model_id: &str) -> Vec<String> {
    let mut efforts: Vec<String> = DEFAULT_EFFORTS.iter().map(|e| e.to_string()).collect();
    if supports_xhigh_effort(model_id) {
        efforts.push("xhigh".to_string());
    }
    efforts
}

/// The gateway also serves Claude models; drop non-OpenAI ones from the picker.
fn is_openai_model(model: &Value) -> bool {
    if let Some(owned_by) = model.get("owned_by").and_then(Value::as_str) {
        return owned_by == "openai";
    }
    let id = model
        .get("id")
        .or_else(|| model.get("model"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    id.starts_with("gpt-") || id.starts_with("openai/")
}

/// Stateful holder for a codex session's model / effort / mode selectors and
/// the ACP `configOptions` derived from them (`SessionConfigState`).
pub struct SessionConfigState {
    model: String,
    effort: Option<String>,
    mode: &'static str,
    models: Vec<(String, String)>,
    efforts: Vec<String>,
}

impl SessionConfigState {
    pub fn new(model: Option<&str>, effort: Option<&str>) -> Self {
        Self {
            model: model
                .filter(|m| !m.is_empty())
                .unwrap_or(DEFAULT_CODEX_MODEL)
                .to_string(),
            effort: effort.map(str::to_string),
            mode: DEFAULT_MODE,
            models: Vec::new(),
            efforts: Vec::new(),
        }
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    pub fn effort(&self) -> Option<&str> {
        self.effort.as_deref()
    }

    pub fn mode(&self) -> &'static str {
        self.mode
    }

    /// Apply the host's initial approval mode (from `_meta.permissionMode`).
    pub fn set_initial_mode(&mut self, permission_mode: Option<&str>) {
        self.mode = resolve_initial_mode(permission_mode);
    }

    /// Apply a `setSessionConfigOption` change; returns whether the mode changed.
    pub fn set_option(&mut self, config_id: Option<&str>, value: Option<&str>) -> bool {
        let Some(value) = value else { return false };
        match config_id {
            Some("model") => {
                self.model = value.to_string();
                false
            }
            Some("effort") => {
                self.effort = Some(value.to_string());
                false
            }
            Some("mode") => {
                self.mode = mode_by_id(value).map(|m| m.id).unwrap_or(self.mode);
                true
            }
            _ => false,
        }
    }

    /// Populate the model + effort selectors from a `model/list` `data` array.
    pub fn load_models(&mut self, raw_models: &[Value]) {
        self.models = raw_models
            .iter()
            .filter(|m| m.get("hidden").and_then(Value::as_bool) != Some(true))
            .filter(|m| is_openai_model(m))
            .filter_map(|m| {
                let id = m
                    .get("id")
                    .or_else(|| m.get("model"))
                    .and_then(Value::as_str)?;
                let name = m.get("displayName").and_then(Value::as_str).unwrap_or(id);
                Some((id.to_string(), name.to_string()))
            })
            .collect();
        let current = raw_models.iter().find(|m| {
            m.get("id").and_then(Value::as_str) == Some(self.model.as_str())
                || m.get("model").and_then(Value::as_str) == Some(self.model.as_str())
        });
        let live_efforts: Vec<String> = current
            .and_then(|m| m.get("supportedReasoningEfforts"))
            .and_then(Value::as_array)
            .map(|efforts| {
                efforts
                    .iter()
                    .filter_map(|e| {
                        e.as_str()
                            .or_else(|| e.get("reasoningEffort").and_then(Value::as_str))
                    })
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        self.efforts = if live_efforts.is_empty() {
            default_efforts_for(&self.model)
        } else {
            live_efforts
        };
    }

    /// Reset the model/effort lists (model/list failed); keeps the current model.
    pub fn clear_models(&mut self) {
        self.models.clear();
        self.efforts.clear();
    }

    pub fn approval_policy(&self) -> &'static str {
        mode_by_id(self.mode)
            .map(|m| m.approval_policy)
            .unwrap_or("on-request")
    }

    /// Per-turn `activePermissionProfile` (codex 0.140.0's enforced sandbox).
    pub fn permission_profile(&self) -> Option<Value> {
        mode_by_id(self.mode)
            .and_then(|m| m.permission_profile)
            .map(|profile| json!({ "extends": profile }))
    }

    /// Per-turn sandbox override; None keeps the spawned editable sandbox.
    pub fn sandbox_policy(&self) -> Option<Value> {
        mode_by_id(self.mode).and_then(|m| {
            if m.sandbox_read_only {
                Some(json!({ "type": "readOnly", "networkAccess": true }))
            } else {
                None
            }
        })
    }

    /// codex's per-turn `collaborationMode`: `{ mode, settings: { model } }`.
    pub fn collaboration_mode_for_turn(&self) -> Value {
        let mode = mode_by_id(self.mode)
            .map(|m| m.collaboration_mode)
            .unwrap_or("default");
        json!({ "mode": mode, "settings": { "model": self.model } })
    }

    /// Builds the ACP configOptions (mode + model + thought_level) the host renders.
    pub fn options(&self) -> Value {
        let mut models: Vec<(String, String)> = if self.models.is_empty() {
            vec![(self.model.clone(), self.model.clone())]
        } else {
            self.models.clone()
        };
        // Ensure the active model stays selectable, else currentValue points at nothing.
        if !models.iter().any(|(id, _)| *id == self.model) {
            models.push((self.model.clone(), self.model.clone()));
        }
        let base_efforts = if self.efforts.is_empty() {
            DEFAULT_EFFORTS.iter().map(|e| e.to_string()).collect()
        } else {
            self.efforts.clone()
        };
        let current_effort = self
            .effort
            .clone()
            .unwrap_or_else(|| base_efforts[0].clone());
        let mut efforts = base_efforts;
        if !efforts.contains(&current_effort) {
            efforts.push(current_effort.clone());
        }

        json!([
            {
                "type": "select",
                "id": "mode",
                "name": "Mode",
                "category": "mode",
                "currentValue": self.mode,
                "options": CODEX_MODES.iter().map(|m| json!({
                    "name": m.name,
                    "value": m.id,
                    "description": m.description,
                })).collect::<Vec<_>>(),
            },
            {
                "type": "select",
                "id": "model",
                "name": "Model",
                "category": "model",
                "currentValue": self.model,
                "options": models.iter().map(|(id, name)| json!({
                    "name": name,
                    "value": id,
                })).collect::<Vec<_>>(),
            },
            {
                "type": "select",
                "id": "effort",
                "name": "Reasoning effort",
                "category": "thought_level",
                "currentValue": current_effort,
                "options": efforts.iter().map(|e| json!({
                    "name": humanize_effort(e),
                    "value": e,
                })).collect::<Vec<_>>(),
            },
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_mode_falls_back_for_unknown_permission_modes() {
        assert_eq!(resolve_initial_mode(Some("plan")), "plan");
        assert_eq!(resolve_initial_mode(Some("read-only")), "read-only");
        assert_eq!(resolve_initial_mode(Some("bypassPermissions")), "auto");
        assert_eq!(resolve_initial_mode(None), "auto");
    }

    #[test]
    fn per_turn_policies_track_mode() {
        let mut config = SessionConfigState::new(Some("gpt-5.5"), None);
        assert_eq!(config.approval_policy(), "on-request");
        assert!(config.permission_profile().is_none());
        assert!(config.sandbox_policy().is_none());
        assert_eq!(config.collaboration_mode_for_turn()["mode"], "default");

        assert!(config.set_option(Some("mode"), Some("plan")));
        assert_eq!(
            config.permission_profile().unwrap()["extends"],
            ":read-only"
        );
        assert_eq!(config.sandbox_policy().unwrap()["type"], "readOnly");
        assert_eq!(config.collaboration_mode_for_turn()["mode"], "plan");

        assert!(config.set_option(Some("mode"), Some("full-access")));
        assert_eq!(config.approval_policy(), "never");
    }

    #[test]
    fn config_options_keep_active_model_selectable_and_add_xhigh() {
        let mut config = SessionConfigState::new(Some("gpt-5.5"), Some("high"));
        config.load_models(&[
            json!({ "id": "gpt-5.5", "displayName": "GPT-5.5", "owned_by": "openai" }),
            json!({ "id": "claude-opus-4-8", "owned_by": "anthropic" }),
        ]);
        let options = config.options();
        let model_option = &options[1];
        let model_values: Vec<&str> = model_option["options"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|o| o["value"].as_str())
            .collect();
        assert_eq!(model_values, vec!["gpt-5.5"]);
        let effort_values: Vec<&str> = options[2]["options"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|o| o["value"].as_str())
            .collect();
        assert_eq!(effort_values, vec!["low", "medium", "high", "xhigh"]);
        assert_eq!(options[2]["currentValue"], "high");
    }
}
