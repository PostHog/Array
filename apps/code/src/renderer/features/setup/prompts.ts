export const WIZARD_PROMPT = `/instrument-integration

After the integration is wired up, also instrument error tracking and session replay (run \`/instrument-error-tracking\`, then add session replay if the framework's posthog-js config supports it).

Run autonomously with sensible defaults — do not ask the user questions. If the PostHog API key isn't already in the project's env files and you can't read it from the PostHog MCP server, leave a placeholder env var and note it in the PR body rather than blocking.`;

export const DISCOVERY_PROMPT = `You are analyzing this codebase to find the highest-value first tasks for the developer.

Scan the codebase for issues in two tiers. Tier 1 applies to every repo. Tier 2 only applies when PostHog is already installed (look for posthog-js, posthog-node, posthog-react-native or similar PostHog SDK imports).

## Tier 1 -- Code health (always)

- **Dead code**: Unused exports, unreachable branches, orphaned files, stale imports. Category: dead_code
- **Duplication / KISS violations**: Copy-pasted logic that should be a shared function, over-abstracted code that could be simpler. Category: duplication
- **Security vulnerabilities**: XSS, SQL injection, command injection, hardcoded secrets, open redirects, missing auth checks, insecure deserialization. Category: security
- **Bugs**: Null dereferences, race conditions, unchecked array access, off-by-one errors, unhandled promise rejections around I/O. Category: bug
- **Performance anti-patterns**: N+1 queries, unbounded loops, synchronous blocking on hot paths, missing pagination. Category: performance

## Tier 2 -- PostHog-specific (only when PostHog SDK is detected)

- **Stale feature flags**: Flags that are always evaluated the same way, flags referenced in code but never toggled, flags guarding code that shipped long ago. Category: stale_feature_flag
- **Error tracking gaps**: Catch blocks that swallow errors without reporting, missing error boundaries, untracked 5xx responses. Category: error_tracking
- **Event tracking improvements**: Key user actions (signup, purchase, invite, upgrade) with no analytics event, events missing useful properties (plan, user role, page context). Category: event_tracking
- **Funnel weak spots**: Multi-step flows (onboarding, checkout, activation) where intermediate steps have no tracking, making drop-off invisible. Category: funnel

## Rules

- Be concrete: reference exact file paths, function names and line numbers — but put paths/lines in the dedicated \`file\` and \`lineHint\` fields, not in the title or description.
- Title: short, action-oriented header (under 60 characters), no paths or line numbers.
- Description: a clear paragraph (2–4 sentences) explaining the problem and the conditions under which it manifests.
- Impact: 1–3 sentences on why it matters (concrete consequence, blast radius, or risk).
- Recommendation: 2–4 sentences pointing at the right shape of the fix without writing the patch. Reference specific functions, types, or files involved.
- Prioritize by impact. Lead with findings that save the most time or prevent the most damage.
- Do NOT suggest documentation, comment, or style/formatting changes.
- Maximum 4 tasks. Quality over quantity.
- Allowed \`category\` values: bug, security, dead_code, duplication, performance, stale_feature_flag, error_tracking, event_tracking, funnel. Do NOT emit any other category.

When you are done analyzing, call create_output with your findings.`;
