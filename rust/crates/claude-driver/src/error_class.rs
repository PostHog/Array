//! Agent error classification.
//!
//! Port of `adapters/error-classification.ts` — the classification string
//! rides in the turn-failure metadata and drives server-side retry decisions,
//! so the patterns must match the TS implementation exactly.

use std::sync::LazyLock;

use regex::Regex;

static STREAM_TERMINATED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)API Error:\s*terminated\b").unwrap());
static CONNECTION_ERROR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)API Error:\s*Connection error\b").unwrap());
static TIMEOUT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)API Error:.*\b(?:timed out|timeout)\b").unwrap());
static PROVIDER_STATUS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)API Error:\s*(?:429|5\d\d)\b").unwrap());

/// Classify error strings surfaced by agent adapters. Transient upstream
/// failures are retriable when they match exact stream/connection patterns or
/// retryable provider HTTP statuses; most other errors are not.
pub fn classify_agent_error(result: &str) -> &'static str {
    let text = result.trim();
    if text.is_empty() {
        return "agent_error";
    }
    // Anthropic SDK surfaces an undici fetch abort as "API Error: terminated".
    if STREAM_TERMINATED.is_match(text) {
        return "upstream_stream_terminated";
    }
    if CONNECTION_ERROR.is_match(text) {
        return "upstream_connection_error";
    }
    if TIMEOUT.is_match(text) {
        return "upstream_timeout";
    }
    if PROVIDER_STATUS.is_match(text) {
        return "upstream_provider_failure";
    }
    "agent_error"
}

#[cfg(test)]
mod tests {
    use super::classify_agent_error;

    #[test]
    fn classification_matches_ts_patterns() {
        assert_eq!(
            classify_agent_error("API Error: terminated"),
            "upstream_stream_terminated"
        );
        assert_eq!(
            classify_agent_error("API Error: Connection error."),
            "upstream_connection_error"
        );
        assert_eq!(
            classify_agent_error("API Error: Request timed out."),
            "upstream_timeout"
        );
        assert_eq!(
            classify_agent_error("API Error: 529 overloaded"),
            "upstream_provider_failure"
        );
        assert_eq!(
            classify_agent_error("API Error: 429 rate limited"),
            "upstream_provider_failure"
        );
        assert_eq!(classify_agent_error("something else"), "agent_error");
        assert_eq!(classify_agent_error(""), "agent_error");
    }
}
