# PR approval agent

AI-assisted PR approval for the `PostHog/code` repo (stamphog).
Deterministic safety gates first, then Claude reviews for showstoppers.

Ported from `PostHog/posthog`'s `tools/pr-approval-agent`. The gate logic
is repo-agnostic; the only repo-specific bits are the default branch (`main`)
and the default `--repo` (`PostHog/code`).

## Usage

Add the `Stamphog` label to a non-draft PR.
The GitHub Action runs the agent and posts an approval or comment.
On approval the label stays so it's visible which PRs were stamphog'd.
On a substantive non-approval (`REFUSE`/`ESCALATE`) the label is removed so it
can be re-applied once the feedback is addressed.
If the review agent can't reach its LLM backend (credentials, credit, or
outage) it returns `ERROR` and **keeps** the label — a transient infra failure
must not silently drop labels across every queued PR. The review retries on the
next push, or re-apply the label once the backend recovers. When the whole
fleet of stamphog reviews suddenly returns `ERROR`, suspect the
`STAMPHOG_ANTHROPIC_API_KEY` org secret first (stamphog uses its own dedicated
Anthropic key, separate from the shared `ANTHROPIC_API_KEY`).

### Local testing

```bash
# run from anywhere inside the code repo (defaults to --repo PostHog/code)
uv run tools/pr-approval-agent/review_pr.py 123

# dry run (gates only, no LLM calls)
uv run tools/pr-approval-agent/review_pr.py 123 --dry-run

# save full result as JSON
uv run tools/pr-approval-agent/review_pr.py 123 --output-json /tmp/review.json

# verbose (show agent tool calls)
uv run tools/pr-approval-agent/review_pr.py 123 -v
```

Requires `gh` CLI authenticated and `ANTHROPIC_API_KEY` in your environment.
Uses PEP 723 inline metadata so `uv run` handles dependencies automatically.

## How it works

```text
"stamphog" label added to PR
  │
  ▼
Prerequisites (hard gate)
  - Not draft, no merge conflicts
  - No outstanding "changes requested" reviews
  │
  ▼
Deny-list (hard gate)
  - Checks file paths + PR title against sensitive categories
  - Any match → gates DENY
  │
  ▼
Size ceiling (hard gate)
  - >500 lines or >20 files → too large for auto-review
  │
  ▼
Tier classification
  - T0-deterministic: docs/tests/config only
  - T1-agent: eligible for review (sub-classified by risk)
  - T2-never: caught by deny-list
  │
  ▼
LLM Review
  - Claude Agent SDK with Read/Grep/Glob tools
  - Explores the repo via git diff, reads source files if needed
  - Looks for showstoppers: production breakage, security, missed deps
  - Gates are authoritative — LLM can tighten but never loosen
  │
  ▼
Final verdict → GitHub review (approve or comment)
```

The bot never posts request-changes — only approves or comments.

## Tiers

### T0 — deterministic

Lowest risk. LLM still reviews but with a lighter bar. PR touches only safe paths:

- Allow-listed extensions: `.md`, `.mdx`, `.txt`, `.rst`, `.json`, `.yaml`, `.yml`, `.toml`, `.ini`, `.cfg`, `.csv`, `.svg`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.ico`, `.webp`, `.snap`, `.lock`
- Allow-listed paths: `docs/`, `README`, `CHANGELOG`, `LICENSE`, `CONTRIBUTING`, `.github/CODEOWNERS`, `.gitignore`, `.editorconfig`, `generated/`, `__snapshots__/`
- Test-only PRs (all changed files are test files)

### T1 — agent-reviewed

Sub-classified by risk to calibrate scrutiny:

| Sub-tier    | Lines       | Files | Breadth           |
| ----------- | ----------- | ----- | ----------------- |
| T1a-trivial | ≤20         | ≤3    | single-area       |
| T1b-small   | ≤100        | ≤5    | not cross-cutting |
| T1c-medium  | ≤300        | ≤15   | not cross-cutting |
| T1d-complex | >300 or >15 | —     | any               |

### T2 — never AI-approved

Deny-listed categories where even a small diff can have high blast radius:

| Category           | Patterns                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------- |
| **auth**           | auth, login, signup, session, token, oauth, saml, sso, permission, oidc, credential, etc.    |
| **crypto_secrets** | crypto, encrypt, decrypt, secret, key, cert, signing, .env, vault                            |
| **migrations**     | migrations/, migrate, backfill, schema_change                                                |
| **infra_cicd**     | terraform, k8s, helm, dockerfile, .github/workflows, deploy, iam, cloudflare, etc.           |
| **billing**        | billing, payment, stripe, invoice, subscription, pricing                                     |
| **public_api**     | openapi, api_schema, swagger, public_api                                                     |
| **deps_toolchain** | package.json, requirements.txt, pyproject.toml, pnpm-lock, uv.lock, Cargo.toml, go.mod, etc. |

**Migrations bypass (inactive in this repo).** In `PostHog/posthog` the **migrations** deny-list is bypassed when a `Migration risk` CI check (published by `analyze_migration_risk` in `ci-backend.yml`) concludes `success`. `PostHog/code` has no such check and uses SQL (drizzle) migrations under `apps/code/src/main/db/migrations/`, so `migration_risk.py` never finds a check, the bypass never fires, and any PR touching `migrations/` is simply denied — the safe default for schema changes. The module is kept verbatim so the two repos stay in sync; if a `Migration risk` check is ever added here it will start working automatically. See `tools/pr-approval-agent/migration_risk.py`.

### Ownership

Uses `.github/CODEOWNERS-soft` as context for the LLM (not a hard gate). This
repo has no `CODEOWNERS-soft` file yet, so the ownership signal is empty until
one is added — the parser degrades gracefully to "no owned paths touched."
Cross-team typo/test/comment fixes are fine; behavioral changes to business logic get escalated.

## Evidence bundle

Every run produces a JSON evidence bundle (`--output-json` locally, uploaded as artifact in CI) containing:

- PR metadata (number, author, title)
- Classification (tier, sub-tier, breadth, commit type, deny categories, ownership)
- Gate results (each gate's pass/fail status and message)
- Reviewer output (verdict, reasoning, risk, issues)
- Final verdict

The GitHub Action uploads this as a build artifact with 30-day retention.

## Architecture

- `review_pr.py` — pipeline orchestrator (fetch → classify → gates → LLM)
- `gates.py` — deterministic classification and deny-list logic
- `github.py` — GitHub data fetching via `gh` CLI
- `reviewer.py` — Claude Agent SDK reviewer (showstoppers prompt)
- `migration_risk.py` — reads the `Migration risk` check (inactive in this repo)
- `dismiss_check.py` — post-push delta classifier (retain vs dismiss prior approval)
- `.github/workflows/pr-approval-agent.yml` — GitHub Action (label trigger)

Run the unit tests with `uv run --with pytest python -m pytest` from this directory.

## Empirical basis

Tier thresholds and deny categories calibrated against 356 PRs that received quick human approval (stamp) in the `PostHog/posthog` repo over ~90 days (the original calibration set — not re-derived for `PostHog/code`):

- 126 tiny (1-10 lines), 102 small (11-50 lines) — most quick approvals are small
- 284/356 single-area — narrow scope dominates
- Top profiles: frontend-only (122), python-only (57), python+test (28), config-only (21), test-only (16)
- 184 `fix`, 101 `chore` — fixes and chores are the modal commit types
- Frontend-only cluster: median 9 lines/1 file, 0% has tests
- Python+test cluster: median 73 lines/2.5 files, 100% has tests
- Python-only cluster: median 13 lines/1 file, 3% has tests

Key insight: size alone is not a safe proxy. Small PRs touching CI workflows, auth, or SAML should never be auto-approved regardless of size. The deny-list exists precisely for this.
