//! `gh` CLI execution with transient-failure retry.
//!
//! Port of `@posthog/git/gh.ts` (`execGh` / `execGhWithRetry`). The sandbox
//! image ships the GitHub CLI; shelling out keeps auth and API behavior
//! identical to the TS implementation. `GH_EXECUTABLE` overrides the binary
//! for tests.

use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone, Default)]
pub struct GhResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct GhOptions {
    pub cwd: Option<String>,
    /// Written to stdin then closed (`gh api graphql --input -`).
    pub input: Option<String>,
    pub token: Option<String>,
    pub timeout: Option<Duration>,
}

fn gh_executable() -> String {
    std::env::var("GH_EXECUTABLE").unwrap_or_else(|_| "gh".to_string())
}

pub async fn exec_gh(args: &[String], options: &GhOptions) -> GhResult {
    let mut command = tokio::process::Command::new(gh_executable());
    command.args(args);
    if let Some(cwd) = &options.cwd {
        command.current_dir(cwd);
    }
    if let Some(token) = &options.token {
        command.env("GH_TOKEN", token);
        command.env("GITHUB_TOKEN", token);
    }
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.kill_on_drop(true);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(err) => {
            return GhResult {
                exit_code: 127,
                error: Some(format!("failed to spawn gh: {err}")),
                ..Default::default()
            }
        }
    };

    if let Some(input) = &options.input {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(input.as_bytes()).await;
            drop(stdin);
        }
    } else {
        drop(child.stdin.take());
    }

    let wait = child.wait_with_output();
    let output = match options.timeout {
        Some(timeout) => match tokio::time::timeout(timeout, wait).await {
            Ok(result) => result,
            Err(_) => {
                return GhResult {
                    exit_code: 1,
                    error: Some(format!("gh timed out after {}ms", timeout.as_millis())),
                    ..Default::default()
                }
            }
        },
        None => wait.await,
    };

    match output {
        Ok(output) => GhResult {
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code().unwrap_or(1),
            error: None,
        },
        Err(err) => GhResult {
            exit_code: 1,
            error: Some(err.to_string()),
            ..Default::default()
        },
    }
}

/// Failures worth retrying: 5xx, the proxy 499, timeouts, and network errors.
/// Deterministic failures (auth, 404, 422, GraphQL validation) are not.
pub fn is_transient_gh_failure(result: &GhResult) -> bool {
    if result.exit_code == 0 {
        return false;
    }
    let text = format!(
        "{} {} {}",
        result.stderr,
        result.error.as_deref().unwrap_or(""),
        result.stdout
    );
    let lower = text.to_lowercase();
    let http_5xx = text
        .split("HTTP 5")
        .nth(1)
        .map(|rest| rest.chars().take(2).all(|c| c.is_ascii_digit()))
        .unwrap_or(false);
    http_5xx
        || text.contains("HTTP 499")
        || lower.contains("timed out")
        || text.contains("ETIMEDOUT")
        || text.contains("ECONNRESET")
        || text.contains("ECONNREFUSED")
        || text.contains("EAI_AGAIN")
        || lower.contains("connection reset")
}

/// `execGhWithRetry` (maxAttempts 3, exponential backoff base 1s).
pub async fn exec_gh_with_retry(args: &[String], options: &GhOptions) -> GhResult {
    const MAX_ATTEMPTS: u32 = 3;
    let mut result = exec_gh(args, options).await;
    let mut attempt = 1;
    while attempt < MAX_ATTEMPTS && is_transient_gh_failure(&result) {
        let backoff = Duration::from_millis(1000 * 2u64.pow(attempt - 1));
        tracing::warn!(
            attempt,
            error = %result.error.as_deref().unwrap_or(&result.stderr),
            "Transient gh failure; retrying"
        );
        tokio::time::sleep(backoff).await;
        result = exec_gh(args, options).await;
        attempt += 1;
    }
    result
}

pub fn args(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transient_detection_matches_ts_patterns() {
        let transient = GhResult {
            stderr: "HTTP 502 Bad Gateway".into(),
            exit_code: 1,
            ..Default::default()
        };
        assert!(is_transient_gh_failure(&transient));

        let deterministic = GhResult {
            stderr: "HTTP 422 Validation Failed".into(),
            exit_code: 1,
            ..Default::default()
        };
        assert!(!is_transient_gh_failure(&deterministic));

        let timeout = GhResult {
            error: Some("gh timed out after 30000ms".into()),
            exit_code: 1,
            ..Default::default()
        };
        assert!(is_transient_gh_failure(&timeout));

        let success = GhResult {
            exit_code: 0,
            ..Default::default()
        };
        assert!(!is_transient_gh_failure(&success));
    }
}
