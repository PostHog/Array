---
name: querying-canvas-data
description: Connect canvas applications to real PostHog data through the injected ph SDK and a declared capability manifest. Use when a canvas displays insights, trends, funnels, retention, web analytics, HogQL, captures interaction events, or needs approved network access.
---

# Querying canvas data

1. Discover real event and property names with PostHog tools. Never guess them.
2. Prefer a saved typed insight—Trends, Funnels, Retention, Paths, or web
   analytics—and validate its result before using it.
3. Record the returned short ID in `capabilities.posthog.insights` and load it
   with `ph.loadInsight(shortId, { dateRange })`.
4. Use `ph.query` only when no saved insight can express the metric. Set
   `capabilities.posthog.inlineQueries` to `true` and keep results bounded.
5. Declare every `ph.capture` event in
   `capabilities.posthog.captureEvents`.
6. Declare each HTTPS origin used by browser networking in
   `capabilities.network.origins`. Do not load executable remote scripts.

Typed insight results are series objects; SQL results are row arrays. Inspect
the actual result instead of assuming their shapes. Own date controls in the
application and pass explicit half-open date ranges. Show loading, empty, and
error states and avoid raw event dumps.

Build validation combines declarations, static extraction, and observed calls.
An undeclared call fails validation and remains blocked at runtime.
