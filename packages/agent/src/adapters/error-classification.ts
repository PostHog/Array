export type AgentErrorClassification =
  | "upstream_stream_terminated"
  | "upstream_connection_error"
  | "upstream_timeout"
  | "upstream_provider_failure"
  | "agent_error";

const UPSTREAM_PROVIDER_ERROR_STATUS_PATTERN = /API Error:\s*(?:429|5\d\d)\b/i;

/**
 * Classify error strings surfaced by agent adapters. Transient upstream
 * failures are retriable when they match exact stream/connection patterns or
 * retryable provider HTTP statuses; most other errors are not.
 */
export function classifyAgentError(
  result: string | undefined,
): AgentErrorClassification {
  if (!result) return "agent_error";
  const text = result.trim();
  // Anthropic SDK surfaces an undici fetch abort as "API Error: terminated".
  if (/API Error:\s*terminated\b/i.test(text)) {
    return "upstream_stream_terminated";
  }
  if (/API Error:\s*Connection error\b/i.test(text)) {
    return "upstream_connection_error";
  }
  if (/API Error:.*\b(?:timed out|timeout)\b/i.test(text)) {
    return "upstream_timeout";
  }
  if (UPSTREAM_PROVIDER_ERROR_STATUS_PATTERN.test(text)) {
    return "upstream_provider_failure";
  }
  return "agent_error";
}
