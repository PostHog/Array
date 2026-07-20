//! Agent error classification.
//!
//! Port of `packages/agent/src/adapters/error-classification.ts`. The
//! classification feeds the `session/update {sessionUpdate:"error"}`
//! broadcast and the recoverable-turn decision.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentErrorClassification {
    UpstreamStreamTerminated,
    UpstreamConnectionError,
    UpstreamTimeout,
    UpstreamProviderFailure,
    AgentError,
}

impl AgentErrorClassification {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::UpstreamStreamTerminated => "upstream_stream_terminated",
            Self::UpstreamConnectionError => "upstream_connection_error",
            Self::UpstreamTimeout => "upstream_timeout",
            Self::UpstreamProviderFailure => "upstream_provider_failure",
            Self::AgentError => "agent_error",
        }
    }

    pub fn is_upstream_failure(&self) -> bool {
        !matches!(self, Self::AgentError)
    }
}

pub const UPSTREAM_PROVIDER_FAILURE_MESSAGE: &str =
    "The upstream AI provider failed to process the request. Please retry the task in a few minutes.";

pub fn classify_agent_error(result: Option<&str>) -> AgentErrorClassification {
    let Some(result) = result else {
        return AgentErrorClassification::AgentError;
    };
    let text = result.trim();
    let lower = text.to_lowercase();

    // Anthropic SDK surfaces an undici fetch abort as "API Error: terminated".
    if regex_match(&lower, "api error:", "terminated") {
        return AgentErrorClassification::UpstreamStreamTerminated;
    }
    if regex_match(&lower, "api error:", "connection error") {
        return AgentErrorClassification::UpstreamConnectionError;
    }
    if lower.contains("api error:") && (lower.contains("timed out") || lower.contains("timeout")) {
        return AgentErrorClassification::UpstreamTimeout;
    }
    if is_retryable_provider_status(&lower) {
        return AgentErrorClassification::UpstreamProviderFailure;
    }
    AgentErrorClassification::AgentError
}

/// `/API Error:\s*<token>\b/i` equivalent for the fixed patterns above.
fn regex_match(lower: &str, prefix: &str, token: &str) -> bool {
    let Some(pos) = lower.find(prefix) else {
        return false;
    };
    lower[pos + prefix.len()..].trim_start().starts_with(token)
}

/// `/API Error:\s*(?:429|5\d\d)\b/i`
fn is_retryable_provider_status(lower: &str) -> bool {
    let Some(pos) = lower.find("api error:") else {
        return false;
    };
    let rest = lower[pos + "api error:".len()..].trim_start();
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.len() != 3 {
        return false;
    }
    // Word boundary: the status must not be followed by another digit.
    digits == "429" || digits.starts_with('5')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_like_ts() {
        assert_eq!(
            classify_agent_error(Some("API Error: terminated")),
            AgentErrorClassification::UpstreamStreamTerminated
        );
        assert_eq!(
            classify_agent_error(Some("API Error: Connection error.")),
            AgentErrorClassification::UpstreamConnectionError
        );
        assert_eq!(
            classify_agent_error(Some("API Error: request timed out")),
            AgentErrorClassification::UpstreamTimeout
        );
        assert_eq!(
            classify_agent_error(Some("API Error: 529 overloaded")),
            AgentErrorClassification::UpstreamProviderFailure
        );
        assert_eq!(
            classify_agent_error(Some("API Error: 429 rate limited")),
            AgentErrorClassification::UpstreamProviderFailure
        );
        assert_eq!(
            classify_agent_error(Some("API Error: 400 bad request")),
            AgentErrorClassification::AgentError
        );
        assert_eq!(
            classify_agent_error(Some("random failure")),
            AgentErrorClassification::AgentError
        );
        assert_eq!(
            classify_agent_error(None),
            AgentErrorClassification::AgentError
        );
    }
}
