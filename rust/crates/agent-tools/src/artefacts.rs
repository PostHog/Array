//! Best-effort commit-artefact reporting.
//!
//! Port of `packages/agent/src/signed-commit-artefacts.ts`: after a successful
//! signed-commit push, record one `commit` artefact per pushed commit on every
//! signal report the task is associated with, so the report's work log shows
//! exactly what landed. Attribution is deterministic — the artefact endpoint
//! reads the `X-PostHog-Task-Id` header, never the model.
//!
//! Credentials come from the sandbox environment (`POSTHOG_API_URL` /
//! `POSTHOG_PERSONAL_API_KEY` / `POSTHOG_PROJECT_ID`), preferring the live
//! agentsh env file for the key so a mid-session token refresh is picked up —
//! the same pattern as `resolve_github_token`. Never fails: a failed artefact
//! post must not fail a commit that already landed.

use serde_json::{json, Value};

use crate::signed_git::{parse_nul_delimited_env, SignedCommitResult, SANDBOX_ENV_FILE};

#[derive(Debug, Clone)]
pub struct SandboxPosthogApi {
    pub api_url: String,
    pub api_key: String,
    pub project_id: u64,
}

fn env_var(file_env: &std::collections::HashMap<String, String>, name: &str) -> Option<String> {
    file_env
        .get(name)
        .cloned()
        .or_else(|| std::env::var(name).ok())
        .filter(|v| !v.is_empty())
}

pub fn resolve_sandbox_posthog_api(env_file_path: &str) -> Option<SandboxPosthogApi> {
    let file_env = std::fs::read_to_string(env_file_path)
        .map(|raw| parse_nul_delimited_env(&raw))
        .unwrap_or_default();
    let api_url = env_var(&file_env, "POSTHOG_API_URL")?;
    let api_key = env_var(&file_env, "POSTHOG_PERSONAL_API_KEY")?;
    let project_id: u64 = env_var(&file_env, "POSTHOG_PROJECT_ID")?.parse().ok()?;
    if project_id == 0 {
        return None;
    }
    Some(SandboxPosthogApi {
        api_url: api_url.trim_end_matches('/').to_string(),
        api_key,
        project_id,
    })
}

// stderr directly (not tracing, which may not be initialized in the MCP
// dispatch path) — stdout is the ACP protocol channel.
fn warn(message: &str) {
    eprintln!("[signed-commit-artefacts] {message}");
}

pub async fn report_commit_artefacts(
    task_id: Option<&str>,
    result: &SignedCommitResult,
    message: &str,
) {
    let Some(task_id) = task_id else {
        return; // Local/desktop run — no task to attribute or associate through.
    };
    let Some(api) = resolve_sandbox_posthog_api(SANDBOX_ENV_FILE) else {
        return; // No sandbox PostHog credentials — nothing to report to.
    };
    if let Err(err) = report_with_api(&api, task_id, result, message).await {
        warn(&format!("failed to record commit artefacts: {err}"));
    }
}

async fn report_with_api(
    api: &SandboxPosthogApi,
    task_id: &str,
    result: &SignedCommitResult,
    message: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let reports_url = format!(
        "{}/api/projects/{}/signals/reports/?task_id={}&limit=100",
        api.api_url,
        api.project_id,
        urlencode(task_id)
    );
    let response = client
        .get(&reports_url)
        .bearer_auth(&api.api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("report lookup failed: HTTP {}", response.status()));
    }
    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    let report_ids: Vec<String> = body
        .get("results")
        .and_then(Value::as_array)
        .map(|results| {
            results
                .iter()
                .filter_map(|r| r.get("id").and_then(Value::as_str).map(String::from))
                .collect()
        })
        .unwrap_or_default();

    for report_id in report_ids {
        for commit in &result.commits {
            let artefact_url = format!(
                "{}/api/projects/{}/signals/reports/{}/artefacts/",
                api.api_url, api.project_id, report_id
            );
            let post = client
                .post(&artefact_url)
                .bearer_auth(&api.api_key)
                .header("X-PostHog-Task-Id", task_id)
                .json(&json!({
                    "artefact_type": "commit",
                    "content": {
                        "repository": result.repository,
                        "branch": result.branch,
                        "commit_sha": commit.sha,
                        "message": message,
                    },
                }))
                .send()
                .await;
            match post {
                Ok(response) if !response.status().is_success() => warn(&format!(
                    "failed to record commit {} on report {report_id}: HTTP {}",
                    commit.sha,
                    response.status()
                )),
                Err(err) => warn(&format!(
                    "failed to record commit {} on report {report_id}: {err}",
                    commit.sha
                )),
                Ok(_) => {}
            }
        }
    }
    Ok(())
}

fn urlencode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::urlencode;

    #[test]
    fn urlencodes_reserved_characters() {
        assert_eq!(urlencode("abc-123_ok.~"), "abc-123_ok.~");
        assert_eq!(urlencode("a b/c"), "a%20b%2Fc");
    }
}
