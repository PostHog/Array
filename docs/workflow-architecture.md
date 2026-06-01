# Workflow architecture: POC → productionisation

This doc explains where the Home **workflow** feature lives today, where it
needs to land for production, and what the seams are so the migration is
mechanical rather than a rewrite.

If you change anything substantive about how workflow config is persisted
or how PR / situation data is computed, update this doc.

---

## 1. What "the workflow" is

A user-authored mapping of **situations** a piece of work can be in
(`working`, `in_review`, `ci_failing`, `changes_requested`, `comments_waiting`,
`ready_to_merge`, `stale`, `done`) → **actions** (skill + prompt) the user
wants available when work lands in each situation.

Three concerns sit on top of that data:

1. **Storage** — where the bindings JSON lives.
2. **PR / signal polling** — fetching CI status, review decision, etc. for
   each PR so situations can be classified accurately.
3. **Classification** — pure function `(workstream, pr) → Set<SituationId>`,
   plus the renderer logic that joins situations to bindings to surface
   quick-action buttons.

Concern (3) doesn't move — it's a pure TS function in
`apps/code/src/shared/types/workflow-classify.ts` and stays that way. Concerns
(1) and (2) move to PostHog when we productionise.

---

## 2. Today (POC, this repo only)

```
┌────────────────────────────────────────────────────────────────────────┐
│  Electron renderer (apps/code/src/renderer/features/home)              │
│                                                                        │
│  • ConfigList edits the workflow via tRPC                              │
│  • useHomeSnapshot groups TaskData → HomeWorkstream                    │
│  • classify() in @shared/ computes situations per workstream           │
│  • useBoundActions joins situations → workflow.bindings → action list  │
│  • HomeWorkstreamRow/Card render situation chips + bound buttons       │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ tRPC (workflow.* router)
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Electron main                                                         │
│                                                                        │
│  WorkflowService  ──→  WorkflowBackend (interface)                     │
│                              │                                         │
│                              ▼                                         │
│                       LocalWorkflowBackend ───→ SQLite                 │
│                       (HomeWorkflowRepository)                         │
│                                                                        │
│  PR polling: BUILT (local). PrSnapshotService ──→ PrSnapshotBackend    │
│  ──→ LocalPrSnapshotBackend ──→ GitService.getPrFull (gh CLI).         │
│  Snapshots are cached, polled, and pushed to the renderer via the      │
│  prSnapshot.onUpdated subscription; classify() now runs with real PR   │
│  data. (pr=null only until a workstream's first fetch resolves.)       │
└────────────────────────────────────────────────────────────────────────┘
```

**Where the actual files are:**

| Concern | File | Lifetime |
|---|---|---|
| Schema (Zod + types) | `apps/code/src/shared/types/workflow.ts` | Permanent. Server will share the shape. |
| Classifier (pure) | `apps/code/src/shared/types/workflow-classify.ts` | Permanent. Server may port to Python; same logic. |
| Validation (pure) | `apps/code/src/shared/types/workflow-validate.ts` | Permanent. Runs both client-side (instant feedback) and inside `WorkflowService.save` (defense in depth). Server re-validates on save with the same rules — port to Python during migration. |
| WorkflowService | `apps/code/src/main/services/workflow/service.ts` | Permanent in shape. Body stays the same after swap. |
| `WorkflowBackend` interface | `apps/code/src/main/services/workflow/backend.ts` | Permanent. The swap point. |
| `LocalWorkflowBackend` | same file | **POC-only.** Deleted post-migration. |
| `CloudWorkflowBackend` | same file | Stub today, the implementation post-migration. |
| SQLite repo | `apps/code/src/main/db/repositories/home-workflow-repository.ts` | **POC-only.** Deleted with the migration. |
| Migration `0007_*` (`home_workflow_config` table) | `apps/code/src/main/db/migrations/` | **POC-only.** Drop the table via a follow-up migration once cloud is the source of truth. |
| tRPC router | `apps/code/src/main/trpc/routers/workflow.ts` | Permanent shape. Same procedures, same Zod schemas — the backend just changes underneath. |

**PR snapshot files (concern 2 — built locally, same swap-point shape):**

| Concern | File | Lifetime |
|---|---|---|
| PR snapshot schema (Zod + type) | `apps/code/src/shared/types/pr-snapshot.ts` | Permanent. The wire contract — server serialises the same shape. |
| `PrSnapshotService` | `apps/code/src/main/services/pr-snapshot/service.ts` | Permanent in shape. Cache + poll + emit; body stays after swap. |
| `PrSnapshotBackend` interface | `apps/code/src/main/services/pr-snapshot/backend.ts` | Permanent. The swap point. |
| `LocalPrSnapshotBackend` (gh CLI) | same file | **POC-only.** Deleted post-migration. |
| `CloudPrSnapshotBackend` | same file | Stub today, the implementation post-migration. |
| `GitService.getTaskPrSnapshot` / `resolveTaskPrUrl` / `getPrFull` + gh→snapshot mappers | `apps/code/src/main/services/git/service.ts` | **POC-only.** Unused once cloud owns PR polling. |
| `useHomeTasks` (all-my-tasks source) | `apps/code/src/renderer/features/home/hooks/useHomeTasks.ts` | Permanent in shape; the server will provide the aggregated snapshot later. |
| tRPC router | `apps/code/src/main/trpc/routers/pr-snapshot.ts` | Permanent shape. `onUpdated` becomes a passthrough to the server feed. |
| Renderer cache + hook | `stores/prSnapshotStore.ts`, `hooks/usePrSnapshots.ts` | Permanent. Subscription source swaps underneath; renderer unchanged. |

---

## 3. Target (production)

```
┌───────────────────────────────┐         ┌────────────────────────────────────┐
│ Electron renderer (unchanged) │         │  posthog/ backend                  │
│                               │         │                                    │
│  ConfigList, useHomeSnapshot, │         │  • CodeWorkflow Django model       │
│  classify(), useBoundActions  │         │  • REST endpoints (see §4)         │
│  …all identical               │         │  • Celery beat task: per-user GH   │
└───────────────┬───────────────┘         │    PR poll, writes CodePrSnapshot  │
                │ tRPC (unchanged)        │  • SSE/WebSocket: pushes           │
                ▼                         │    WorkflowChanged +               │
┌───────────────────────────────┐         │    PrSnapshotUpdated to clients    │
│ Electron main                 │         └──────────────────┬─────────────────┘
│                               │                            │
│  WorkflowService              │                            │
│    │                          │                            │
│    ▼                          │   HTTPS (auth'd)           │
│  CloudWorkflowBackend ────────┼────────────────────────────┘
│  (calls posthog API)          │
│                               │
│  No more SQLite for workflow. │
│  No more local PR polling.    │
└───────────────────────────────┘
```

**What moves to `posthog/`:**

1. **Workflow persistence.** Per-user, syncs across devices, optimistic
   concurrency on a monotonic `version` (same as today's local SQLite logic).
2. **PR polling worker.** One server-side worker walks every user's
   tracked PRs, batches by host, respects per-user `gh`/PAT rate-limit
   budgets, and writes snapshots into a `CodePrSnapshot` table that
   downstream services read.
3. **Snapshot delivery.** Server pushes `WorkflowChanged` and
   `PrSnapshotUpdated` over an existing realtime channel (SSE or
   WebSocket). The renderer subscribes via tRPC — the same shape as
   today's `workflow.onChanged`, just sourced from upstream.

**What stays in `apps/code/`:**

1. The UI — ConfigList, list/board views, action firing.
2. `WorkflowService`, `WorkflowBackend` interface, classifier — same
   files, same shapes.
3. `TaskCreationSaga` invocation when a user clicks a bound action.
   Already cloud, no change.
4. Local task grouping in `useHomeSnapshot` — eventually moves
   server-side too, but it's not on the critical migration path.

---

## 4. Server-side API sketch

Subject to backend design review; this is what the Electron side expects.

```
GET    /api/projects/:project_id/code_workflow/
       → 200 WorkflowConfig
       → 404 (no config yet — client seeds default)

PUT    /api/projects/:project_id/code_workflow/
       body: { config: WorkflowConfig, expected_version: number }
       → 200 { status: "saved", config }
       → 409 { status: "conflict", config }       (version drifted)
       → 422 { status: "invalid", diagnostics }   (schema violation)

DELETE /api/projects/:project_id/code_workflow/
       → 200 WorkflowConfig (the reseeded default)
```

The `WorkflowConfig` Zod schema in `@shared/types/workflow.ts` is the
contract — the backend serialises it as-is. If we add fields, we add
them once in the shared schema and both ends pick them up.

For real-time updates, ride whichever channel `posthog/` already uses
for live data (today: long-poll + the new task SSE channel). The tRPC
subscription `workflow.onChanged` in this repo becomes a passthrough.

---

## 5. The PR polling worker (when we build it)

**POC option** (BUILT — this is what ships today): A `PrSnapshotService`
in Electron main, running locally, keyed by **task** (not PR URL) so a PR
that only exists on a branch is still found. Per task it resolves the PR
the way the rest of the app does — cloud-run URL → linked-branch lookup
(`gh pr list --head`) → worktree `getPrStatus` — via
`GitService.getTaskPrSnapshot` / `resolveTaskPrUrl`, then enriches with
CI/review state via `getPrFull`. Owned by the same DI container behind a
`PrSnapshotBackend` interface (`LocalPrSnapshotBackend` now,
`CloudPrSnapshotBackend` stubbed for the swap). Exposed via tRPC:
`prSnapshot.getSnapshots` (query over `{ taskId, cloudPrUrl }[]`, also
registers them for polling), `prSnapshot.refresh` (mutation), and
`prSnapshot.onUpdated` (subscription). The renderer caches pushes in
`prSnapshotStore` (keyed by task id) and `useHomeSnapshot` feeds the
matching snapshot into `buildSnapshotFromTasks` → `classify()`.

Coverage: Home sources **all of the current user's tasks** via
`useHomeTasks` (the full `useTasks` list, not the sidebar's
workspace-scoped, paginated slice), so cloud tasks and tasks without a
local checkout surface too.

**Production**: A Celery beat task in `posthog/` paging through
`CodeWorkflow` rows, batching the PRs each user is tracking, hitting
the GitHub API with the user's stored PAT, writing snapshots into
`CodePrSnapshot`, and emitting a realtime event when a snapshot
changes. Clients subscribe; the Electron tRPC subscription becomes a
passthrough.

In both cases the shape we hand to `classify()` is identical:
`{ state, ciStatus, reviewDecision, unresolvedThreads, mergeable, … }`.

---

## 6. The actual swap (when PostHog is ready)

For this Electron app:

1. **Implement `CloudWorkflowBackend.load/save/delete`** in
   `apps/code/src/main/services/workflow/backend.ts` — replacing the
   `throw new Error("not implemented yet")` stubs. Use the existing
   auth'd HTTP client. Validate the response with
   `workflowConfig.safeParse` before returning; on shape mismatch,
   return `null` so the service reseeds.
2. **Flip the DI binding** in `apps/code/src/main/di/container.ts`
   from `LocalWorkflowBackend` to `CloudWorkflowBackend`. One line.
3. **Add a follow-up Drizzle migration** that drops the
   `home_workflow_config` table.
4. **Delete the POC-only files:** `home-workflow-repository.ts`, the
   `homeWorkflowConfig` table in `schema.ts`, the `0007_*` migration
   stays in place (historical) but the drop migration succeeds it.
5. **Rewrite `workflow.onChanged`** in
   `apps/code/src/main/trpc/routers/workflow.ts` to fan out the
   server's realtime event instead of `WorkflowService.emit`. Same
   tRPC contract — renderer doesn't change.

For the PR polling worker, the local `PrSnapshotService` already exists.
The swap mirrors the workflow backend:

1. **Implement `CloudPrSnapshotBackend.fetch`** in
   `apps/code/src/main/services/pr-snapshot/backend.ts` — call the
   auth'd API, validate with `prSnapshot.safeParse`, return the rows.
2. **Flip the DI binding** in `apps/code/src/main/di/container.ts` from
   `LocalPrSnapshotBackend` to `CloudPrSnapshotBackend`. One line.
3. **Delete the POC-only PR-fetch code:** `LocalPrSnapshotBackend` and
   `GitService.getPrFull` + its gh→snapshot mappers.
4. Optionally **rewrite `prSnapshot.onUpdated`** to fan out the server's
   realtime event instead of the local poll loop's emit. Same tRPC
   contract — renderer and `prSnapshotStore` don't change.

For the classifier: nothing changes.

---

## 7. Things we deliberately did NOT do in the POC

- **No user identity.** Bindings are anonymous, one row per app
  install. Cloud version is per-user.
- **Local PR polling, with one gap.** PR/CI snapshots are now fetched
  locally via the `gh` CLI (`PrSnapshotService`), so `ci_failing`,
  `changes_requested`, `ready_to_merge`, `in_review`, and `done` all
  fire on real data. Caveat: `unresolvedThreads` (which drives
  `comments_waiting`) is only counted for the *current user's own open
  PRs* — it needs an extra GraphQL call, so we don't pay it elsewhere.
  The cloud worker will populate it for every PR.
- **No `auto`-trigger actions.** We dropped the auto trigger
  intentionally — we can't reliably watch for state transitions across
  cloud and local task setups. Once the server-side polling worker
  exists it could fire auto actions, but that's a deliberate future
  decision.
- **No cross-device sync.** Implicit, but worth naming: today, if you
  edit the workflow on one machine and open the app on another, the
  second machine has its own row.
- **No action firing.** `useBoundActions` toasts "not wired yet" when a
  user clicks a button. The seam to `TaskCreationSaga` is the next
  slice — independent of the cloud migration.

Each of these is a follow-up slice with its own clear seam — none of
them require redesigning what the POC already built.
