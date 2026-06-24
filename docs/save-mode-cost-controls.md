# Save Mode + Cost Controls (alpha)

Alpha feature to cut LLM spend for both the user and PostHog. Gated by the
`llm-gateway-cost-controls` feature flag (early-access **alpha** stage) — off for
everyone until opted in. Names kept; "alpha", not "prototype".

## The honest framing

- The gateway already **prices** every call and passes caching through — pricing
  ≠ minimizing. A 0%-cache-hit session and a 90% one both price correctly; one
  costs ~10× more.
- **Real saving** (money leaves the total bill): cache efficiency, lower
  effort/verbosity, batch discount.
- **Pricing/substitution** (not real saving): model downshift — and on metered
  billing it can *reduce* PostHog revenue. Save mode is mainly an
  acquisition/retention lever, not a margin lever.
- Settle first: **what's the real `posthog_code` cache-hit rate?** It decides
  whether this is a savings project or a budget-UX project. Answered by the
  queries below over existing telemetry (no new code).

## Where the code lives (real homes, tested)

**FE — `packages/core/src/save-mode/`** (pure modules, same pattern as
`billing/usageDisplay.ts`; Biome + Vitest 10/10 + `tsc` clean):
- `saveMode.ts` — `resolveSaveMode()`: (mode + requested model/effort) →
  effective model/effort + terseness reminder + telemetry props.
- `budget.ts` — `evaluateBudget()`: month-to-date spend vs cap →
  ok/warn/engage/blocked + recommended mode.

**BE — `posthog` repo, `services/llm-gateway/`** (ruff + mypy --strict + pytest 21):
- `src/llm_gateway/cost_efficiency.py` — cache-hit ratio + busted-session detector + savings math.
- `src/llm_gateway/batch_routing.py` — which products route through the 50%-off Batch API.
- `src/llm_gateway/budget_guard.py` — authoritative hard-cap gate (fail-open; never kills in-flight).
- `src/llm_gateway/cost_controls.py` — the **alpha flag gate** (`cost_controls_enabled`), off by default.
- `cost-queries/cache_hit_ratio.promql`, `cost-queries/cost_analytics.hogql`.

**Flag — `frontend/src/lib/constants.tsx`**: `LLM_GATEWAY_COST_CONTROLS = 'llm-gateway-cost-controls'`.

## The alpha loop

EarlyAccessFeature at **alpha** stage (created at runtime in PostHog) →
opted-in users get the `llm-gateway-cost-controls` flag → the Code app shows the
save-mode UI and forwards `x-posthog-flag-llm-gateway-cost-controls: true` → the
gateway's `cost_controls_enabled(get_posthog_flags())` returns true → behavior
applies. Everyone else: untouched.

## What's left (needs a running stack + review)

1. **Gateway request path** (`api/anthropic.py` → `_handle_anthropic_messages`):
   call the gate, then `budget_guard` (needs a spend resolver like
   `quota_resolver`) and `batch_routing` (needs the Anthropic SDK batch
   submit/poll). Not landed blind — these change critical request handling.
2. **FE UI**: a save-mode toggle + budget meter in `packages/ui`, a `saveMode`
   view pref in the settings store, read the alpha flag, and stamp
   `$ai_save_mode` / `$ai_baseline_model` via `buildGatewayPropertyHeaders`.
3. **Create the alpha `EarlyAccessFeature`** (UI: Feature management → Early
   access features; stage = alpha; linked flag key `llm-gateway-cost-controls`).

## Cross-check vs PostHog's agent-cost article

(posthog.com/blog/optimizing-agent-cost) — their hard-won lessons, mapped here.

**They validated, we operationalize.** Their #1 finding — cache writes cost ~12.5×
reads, so naive context-splitting backfires — is exactly what `cache_efficiency` /
`classify_session` detect (a "busted" session = paying the write premium for a
cache nobody reads). Their one-off benchmark becomes a standing signal here.

**Folded into save mode** (`TERSE_REMINDER`): trust prior tool results +
compacted summaries, don't re-read to re-verify (their "reduced bureaucratic
verification" + "avoid compaction cascades"); avoid subagents unless work fans
out (their "subagent elimination").

**What the article missed, that this flow adds:**
1. **Batch API (50% off)** for async/deterministic flows — absent from the
   article; `batch_routing.py` applies it to exactly the scheduled, deterministic
   "conclude"-style steps they describe.
2. **Continuous measurement, not one-off benchmarking** — they validate against
   benchmarks by hand; a Signals scout over the cache-hit / busted-session
   queries flags regressions (cache-busting, compaction cascades) automatically.
3. **Model tiering** — they hand-tune one model; the deterministic, low-judgment
   sub-steps can run on a cheaper model (the save-mode downshift generalizes this).
4. **The 12.5× rule as an automated guardrail**, not human intuition — the
   busted-session detector is the encoded version.
5. **User-facing budget caps** — the article is internal eng; `budget_guard` +
   the save-mode toggle are the product layer.

## Re-exploration: what's already covered, and the next lever

**Already handled upstream (do not rebuild):**
- **Tool search / deferred MCP loading** — `ENABLE_TOOL_SEARCH: "auto:0"` in the
  Claude adapter (`session/options.ts`); MCP tool schemas are offloaded behind
  tool search, not inlined into every turn.
- **Per-component context cost** — `adapters/claude/context-breakdown.ts`
  already estimates systemPrompt / tools / rules / skills / mcp / subagents /
  conversation tokens.

**New lever built — cache TTL (the idle-expiry gap):**
- `services/llm-gateway/src/llm_gateway/cache_ttl.py` (`upgrade_cache_ttl`):
  upgrades the SDK's ephemeral cache breakpoints to a **1-hour TTL** for
  interactive products (`posthog_code`, `slack_app`), so think-time gaps > 5 min
  stop forcing full cache rewrites — the exact 5–15 min idle-expiry the article
  flagged. Pure transform, 6 tests green; gated upstream by `cost_controls`.
  Neither the article nor our prior flow had this.

**Candidates found, not built (need a judgment call / SDK check):**
- **Context editing** (`clear_tool_uses`) — prune stale tool results from long
  sessions. The Claude Agent SDK may already compact; verify before adding.
- **Enrichment token cost** — the read-enrichment hook injects PostHog
  annotations into file reads (tokens every read). Could be gated off in
  `max_save` (trades the outcome-aware value for tokens).
- **Surface `context-breakdown` in the cost UI** — the data already exists;
  expose "where your tokens go" and flag bloat (skills / rules / mcp resident
  size) so users can trim.

## Open questions

1. Actual `posthog_code` cache-hit rate today (run `cost_analytics.hogql` query 3).
2. Is `getPersonalSpendAnalysis` cheap enough to poll month-to-date, or do we
   need a cached "spend so far" endpoint?
