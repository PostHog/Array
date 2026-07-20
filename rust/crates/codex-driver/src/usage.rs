//! Token usage tracking and the `_posthog/*` usage payloads. Port of
//! `token-usage.ts` + `usage-tracker.ts` + `ext-notifications.ts` (and the
//! `buildBreakdown` subset of `context-breakdown.ts`).

use serde_json::{json, Value};

/// BASELINE_TOKENS from codex-rs protocol.rs — the resident floor we cannot
/// attribute per-source.
pub const CODEX_BASELINE_TOKENS: u64 = 12_000;

const CHARS_PER_TOKEN: usize = 4;

pub fn estimate_tokens(text: &str) -> u64 {
    (text.len() / CHARS_PER_TOKEN) as u64
}

/// The one place a `thread/tokenUsage/updated` payload is decoded, so the
/// renderer gauge and the usage breakdown cannot drift onto different
/// fallback orders. This turn's `last`, not cumulative `total` (which
/// over-reports and pegs the gauge); `total` is the fallback for pre-`last`
/// builds.
pub fn read_token_usage(params: &Value) -> Option<(Value, u64, Option<u64>)> {
    let token_usage = params.get("tokenUsage")?;
    let context = token_usage
        .get("last")
        .filter(|v| !v.is_null())
        .or_else(|| token_usage.get("total").filter(|v| !v.is_null()))?
        .clone();
    let used = context
        .get("totalTokens")
        .and_then(Value::as_u64)
        .or_else(|| context.get("inputTokens").and_then(Value::as_u64))?;
    let size = token_usage
        .get("modelContextWindow")
        .and_then(Value::as_u64);
    Some((context, used, size))
}

#[derive(Debug, Clone, Copy, Default)]
pub struct AccumulatedUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cached_read_tokens: u64,
    pub cached_write_tokens: u64,
}

/// Tracks token usage for one codex thread.
#[derive(Default)]
pub struct UsageTracker {
    /// Baseline systemPrompt bucket: the resident floor + the host's system
    /// prompt estimate (codex doesn't attribute input tokens by source).
    baseline_system_prompt: u64,
    last_turn: Option<AccumulatedUsage>,
    context_used: Option<u64>,
}

impl UsageTracker {
    pub fn set_baseline(&mut self, system_prompt: Option<&str>) {
        self.baseline_system_prompt =
            CODEX_BASELINE_TOKENS + system_prompt.map(estimate_tokens).unwrap_or(0);
    }

    /// Zero the per-turn view at turn start so a token-less turn reports 0.
    pub fn reset_for_turn(&mut self) {
        self.last_turn = None;
        self.context_used = None;
    }

    /// Ingest a `thread/tokenUsage/updated` payload; returns the live
    /// `_posthog/usage_update` params (minus sessionId), or None if unusable.
    pub fn ingest(&mut self, params: &Value) -> Option<Value> {
        let (context, used, size) = read_token_usage(params)?;
        self.context_used = Some(used);
        let read = |key: &str| context.get(key).and_then(Value::as_u64).unwrap_or(0);
        self.last_turn = Some(AccumulatedUsage {
            input_tokens: read("inputTokens"),
            output_tokens: read("outputTokens"),
            cached_read_tokens: read("cachedInputTokens"),
            // codex's TokenUsageBreakdown has no cache-write field; 0 is authoritative.
            cached_write_tokens: 0,
        });
        Some(json!({
            "used": used,
            "size": size,
            "usage": {
                "inputTokens": context.get("inputTokens"),
                "outputTokens": context.get("outputTokens"),
                "cachedReadTokens": context.get("cachedInputTokens"),
                "reasoningTokens": context.get("reasoningOutputTokens"),
                "totalTokens": context.get("totalTokens"),
            },
        }))
    }

    /// Per-turn usage for `_posthog/turn_complete` — codex's `last`, not a delta.
    pub fn per_turn_usage(&self) -> AccumulatedUsage {
        self.last_turn.unwrap_or_default()
    }

    /// Live context occupancy (same derivation as the renderer gauge).
    pub fn context_tokens(&self) -> Option<u64> {
        self.context_used
    }

    /// `_posthog/usage_update` (breakdown variant): per-source context
    /// attribution, folding the baseline estimate with the live usage.
    pub fn breakdown(&self, context_used: u64) -> Value {
        let conversation = context_used.saturating_sub(self.baseline_system_prompt);
        json!({
            "systemPrompt": self.baseline_system_prompt,
            "tools": 0,
            "rules": 0,
            "skills": 0,
            "mcp": 0,
            "subagents": 0,
            "conversation": conversation,
        })
    }
}

/// `_posthog/turn_complete` params. `totalTokens` is derived so consumers
/// don't re-sum.
pub fn turn_complete_params(session_id: &str, stop_reason: &str, usage: AccumulatedUsage) -> Value {
    json!({
        "sessionId": session_id,
        "stopReason": stop_reason,
        "usage": {
            "inputTokens": usage.input_tokens,
            "outputTokens": usage.output_tokens,
            "cachedReadTokens": usage.cached_read_tokens,
            "cachedWriteTokens": usage.cached_write_tokens,
            "totalTokens": usage.input_tokens
                + usage.output_tokens
                + usage.cached_read_tokens
                + usage.cached_write_tokens,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_last_over_total_and_falls_back() {
        let params = json!({
            "tokenUsage": {
                "total": { "inputTokens": 100, "totalTokens": 150 },
                "last": { "inputTokens": 20, "outputTokens": 7, "cachedInputTokens": 3, "totalTokens": 30 },
                "modelContextWindow": 272000,
            },
        });
        let (_, used, size) = read_token_usage(&params).unwrap();
        assert_eq!(used, 30);
        assert_eq!(size, Some(272000));

        let legacy = json!({ "tokenUsage": { "total": { "inputTokens": 100 } } });
        let (_, used, size) = read_token_usage(&legacy).unwrap();
        assert_eq!(used, 100);
        assert_eq!(size, None);
        assert!(read_token_usage(&json!({})).is_none());
    }

    #[test]
    fn turn_complete_totals_all_components() {
        let params = turn_complete_params(
            "s1",
            "end_turn",
            AccumulatedUsage {
                input_tokens: 20,
                output_tokens: 7,
                cached_read_tokens: 3,
                cached_write_tokens: 0,
            },
        );
        assert_eq!(params["usage"]["totalTokens"], 30);
        assert_eq!(params["stopReason"], "end_turn");
    }

    #[test]
    fn breakdown_attributes_conversation_above_baseline() {
        let mut tracker = UsageTracker::default();
        tracker.set_baseline(Some(&"x".repeat(4000)));
        let breakdown = tracker.breakdown(20_000);
        assert_eq!(breakdown["systemPrompt"], 13_000);
        assert_eq!(breakdown["conversation"], 7_000);
        // Below the baseline, conversation clamps to zero.
        assert_eq!(tracker.breakdown(1_000)["conversation"], 0);
    }
}
