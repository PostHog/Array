import { BASE_CATEGORY_ENUM } from "@posthog/core/setup/types";

// Appended to every prompt that instruments an integration. Writing env vars to
// .env files does nothing for the deployed app, and no run can read the hosting
// provider's env, so the checklist is unconditional. Where it gets delivered is
// not: these prompts run in cloud, worktree and local modes (WorkspaceMode), and
// a PR is never opened automatically in any of them — hence the two-branch phrasing.
export const DEPLOYMENT_ENV_VAR_PROMPT = `

## Required: hand off an env var checklist

Adding env vars to \`.env\`, \`.env.local\` or \`.env.example\` only covers local development. It does not set them on the deployed app, so production will send no events until someone sets them in the hosting provider. You cannot read or set the hosting provider's env from here, so always assume they are missing and always hand off the checklist below.

Detect the deployment target from repo-root markers: \`vercel.json\` or \`.vercel/\` → Vercel; \`netlify.toml\` → Netlify; \`wrangler.toml\` or \`wrangler.jsonc\` → Cloudflare; \`fly.toml\` → Fly.io. If nothing matches, call it "your hosting provider" and give the generic steps.

Deliver it wherever this run ends:
- If you open a pull request, its body must lead with the checklist — above the summary of changes — under the heading "Before you merge: set environment variables in <provider>".
- If you are working against a local checkout and not opening a pull request, print the same checklist to the user as the final message of the run, under the heading "Before you deploy: set environment variables in <provider>".

Either way the checklist contains:

- Every env var key name the integration reads, exactly as it appears in the code (e.g. the PostHog public key and host vars for this framework).
- Steps for the detected provider:
  - Vercel: \`vercel env add <KEY> production\` per key, or Project Settings → Environment Variables.
  - Netlify: \`netlify env:set <KEY> <value>\` per key, or Site configuration → Environment variables.
  - Cloudflare: \`wrangler secret put <KEY>\` per key, or \`[vars]\` in the wrangler config for non-secret values.
  - Fly.io: \`fly secrets set <KEY>=<value>\` per key.
  - Unknown provider: instruct the user to add each key wherever their production environment defines env vars, and to redeploy.
- A plain statement that until these are set in <provider>, the production deployment will send no events to PostHog.

Never put secret values in a PR body — key names only. Point the user at their PostHog project settings for the value.`;

const DISCOVERY_PROMPT_BASE = `You are analyzing this codebase to find the highest-value first tasks for the developer.

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
- **Funnel weak spots**: Multi-step flows (onboarding, checkout, activation) where intermediate steps have no tracking, making drop-off invisible. Category: funnel`;

const DISCOVERY_PROMPT_EXPERIMENT_TIER = `

## Tier 3 -- Experiment opportunities (only when PostHog SDK is detected)

- **Experimentable surfaces**: User-facing surfaces where an A/B test would meaningfully inform a product decision — pricing pages, paywalls, primary CTAs, signup/onboarding flows, empty states, recommendation lists, upgrade prompts. Category: experiment
  - Title: a one-line hypothesis ("Test 'Get started free' vs 'Sign up' on landing CTA")
  - Description: state the hypothesis as a sentence — what you would change and why you think it would move the metric
  - Impact: name the primary metric you would measure (e.g. "Sign-up conversion on /landing") and what a winning variant would look like
  - Recommendation: describe the control and test variants concretely (exact copy, layout change, or behavior), and note any flag wiring required (\`posthog.getFeatureFlag\`)
  - Only suggest experiments where: (a) the surface is in code you can point at, (b) the variant is implementable without backend changes you can't see, and (c) the metric is something a typical PostHog event would capture

If you find at least one credible Tier 3 experiment opportunity, include at least one experiment-category task in your output — even if doing so displaces a lower-impact Tier 1/2 finding. Do not fabricate an experiment to fill the slot: if no credible candidate exists, omit the category entirely.`;

function buildDiscoveryRules(includeExperiments: boolean): string {
  const allowed = (
    includeExperiments
      ? [...BASE_CATEGORY_ENUM, "experiment"]
      : [...BASE_CATEGORY_ENUM]
  ).join(", ");
  return `

## Rules

- Be concrete: reference exact file paths, function names and line numbers — but put paths/lines in the dedicated \`file\` and \`lineHint\` fields, not in the title or description.
- Title: short, action-oriented header (under 60 characters), no paths or line numbers.
- Description: a clear paragraph (2–4 sentences) explaining the problem and the conditions under which it manifests.
- Impact: 1–3 sentences on why it matters (concrete consequence, blast radius, or risk).
- Recommendation: 2–4 sentences pointing at the right shape of the fix without writing the patch. Reference specific functions, types, or files involved.
- Prioritize by impact. Lead with findings that save the most time or prevent the most damage.
- Do NOT suggest documentation, comment, or style/formatting changes.
- Maximum 4 tasks. Quality over quantity.
- Allowed \`category\` values: ${allowed}. Do NOT emit any other category.

When you are done analyzing, call create_output with your findings.`;
}

export function buildDiscoveryPrompt({
  includeExperiments,
}: {
  includeExperiments: boolean;
}): string {
  const middle = includeExperiments ? DISCOVERY_PROMPT_EXPERIMENT_TIER : "";
  return `${DISCOVERY_PROMPT_BASE}${middle}${buildDiscoveryRules(includeExperiments)}`;
}
