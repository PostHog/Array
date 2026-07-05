# Home workflow architecture

The Home tab's data layer – workstream grouping, PR polling, situation
classification, and workflow-config persistence – runs **server-side in
PostHog**, in the `tasks` product (`products/tasks/` in the posthog repo). The
Electron app is a thin authenticated client.

The Electron app and the PostHog `tasks` product share wire shapes and
classification logic – if you change either, update both sides and this doc.

---

## 1. What "the workflow" is

A user-authored mapping of **situations** a piece of work can be in
(`working`, `in_review`, `ci_failing`, `changes_requested`, `comments_waiting`,
`ready_to_merge`, `stale`, `done`) → **actions** (skill + prompt) the user
wants available when work lands in each situation.

Three concerns sit on top of that:

1. **Storage** – the per-user bindings JSON (`CodeWorkflowConfig`).
2. **PR / signal polling** – CI status, review decision, threads, mergeability
   for each tracked PR (`CodePrSnapshot`).
3. **Grouping + classification** – group a user's tasks into workstreams and
   compute the situations each is in (`CodeWorkstream`).

All three live in PostHog now.

---

## 2. Server (PostHog `products/tasks/backend/`)

**Pure logic** (ported 1:1 from the original TypeScript; unit-tested without
Django) – `code_workstreams/`:

- `situations.py` – situation ids, priority order, attention set.
- `classify.py` – `classify(input) → set[SituationId]`, `pick_primary_situation`.
- `grouping.py` – `build_workstreams(tasks, pr_by_task, now)`: groups tasks
  (PR URL → repo+branch → path), extracts the active-agent set, classifies, and
  buckets into needs-attention / in-progress.
- `default_workflow.py`, `validation.py` – default bindings + save validation.

**Models** (`models.py`):

- `CodeWorkflowConfig` – per `(team, user)` bindings + monotonic `version`.
- `CodePrSnapshot` – per `(team, pr_url)` polled GitHub state (shared across a
  team's users).
- `CodeWorkstream` – per `(team, user, key)` grouped + classified workstream;
  the API reads these rows directly.

**Temporal worker** (`temporal/code_workstreams/`, task queue
`TASKS_TASK_QUEUE`):

- `evaluate-code-workstreams` (dispatcher) – a Temporal **Schedule** every 3 min
  enumerates teams with recent code activity and fans out one child workflow per
  team (bounded concurrency).
- `evaluate-team-code-workstreams` – per team: `load_team_pr_urls` →
  `poll_team_pull_requests` (GitHub GraphQL via the team integration, rate-limit
  aware, heartbeated) → `rebuild_team_workstreams` (group + classify + upsert
  `CodeWorkstream`, prune stale).
- On-demand refresh: `client.trigger_team_code_workstreams_evaluation(team_id)`.

PR state is fetched with `GitHubIntegration.get_pull_request_snapshot(pr_url)`
(a single GraphQL call: state, draft, mergeable, review decision, CI rollup,
unresolved threads, requested reviewers).

**REST API** (`code_home_api.py`, registered under `/api/projects/:id/`):

- `GET    /code_workflow/`        → `WorkflowConfig` (seeds the default first time)
- `POST   /code_workflow/save/`   → `{ config, expectedVersion }` → `SaveResult`
  (`saved` | `conflict` (409) | `invalid` (422)); optimistic concurrency + validation
- `POST   /code_workflow/reset/`  → reseed default
- `GET    /code_home/`            → `HomeSnapshot { activeAgents, needsAttention, inProgress }`
  (workstreams from `CodeWorkstream`; `activeAgents` computed live from `TaskRun`)
- `POST   /code_home/refresh/`    → trigger an on-demand evaluation (202)

Responses use the exact camelCase wire shapes the Electron app validates.

---

## 3. Electron app (`apps/code/`)

Thin authenticated clients over the REST API – no local persistence, no `gh`
polling, no client-side classification:

| Concern | File |
|---|---|
| Snapshot wire schema (Zod, source of truth for the UI types) | `packages/core/src/home/schemas.ts` |
| Workflow config wire schema | `packages/core/src/workflow/schemas.ts` |
| HTTP client methods (`code_home/`, `code_workflow/*`) | `packages/api-client/src/posthog-client.ts` |
| Snapshot polling query | `packages/ui/src/features/home/hooks/useHomeSnapshot.ts` |
| Workflow query + save/reset mutations (cache write-back) | `packages/ui/src/features/home/hooks/useWorkflow.ts` |
| Board column projection (pure, UI-only) | `packages/ui/src/features/home/utils/boardColumns.ts` |

Delivery for v1 is **REST + client poll**: `HomeService` polls
`GET /code_home/` and emits `home.onSnapshotUpdated`; `WorkflowService` calls the
config endpoints and emits `workflow.onChanged`. Both subscriptions write back
into the TanStack Query cache. A realtime push channel (SSE) is a future
enhancement – the tRPC subscription contract wouldn't change.

`WorkflowService.get()` surfaces network/load failures rather than masking them:
the config endpoint is the only source of truth, so when it can't be reached the
canvas shows an offline/error state with a retry instead of fabricating a config.

---

## 4. What is intentionally NOT here yet

- **`unresolvedThreads` for PRs the user doesn't author** – only the M3 reviewer
  flow needs it; `is_current_user_requested_reviewer` defaults false.
- **Realtime push (SSE)** – v1 is client poll; the worker keeps server data fresh.
- **Snooze / mute / viewed** (`home_attention_state`) – M4, not migrated yet.
- **`auto`-trigger actions** – deliberately omitted.
- **Continue-as-new batching in the dispatcher** – current active-team counts
  fan out in one pass (capped + logged); page with continue-as-new at larger scale.
