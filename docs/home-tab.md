# Home tab

## 1. Summary

A new **Home** sidebar tab that helps users reach inbox zero on code work. Home aggregates PRs, branches, and worktrees into *workstreams* and surfaces only the items that need the user's attention right now — things that are not already obvious from the existing task list.

The existing task panel already shows what your agents are doing (in-flight, failed, cancelled, needing permission). Home does **not** duplicate that. Home is about everything that happens *around* an agent task — the PR it produced, the comments people left on it, the CI that's failing, the branch that never got a PR, the review someone is waiting on you for.

Home should answer:

- What's running right now? (glanceable strip — no detail)
- What needs me to do something so this work can ship?
- What's stale and should be picked up, closed, or cleaned up?
- Which PRs have feedback, failing checks, or are waiting on my review?

## 2. Goals

1. **One surface for "what needs me"** — PR feedback, failing CI, review requests, stale branches, ready-to-merge PRs.
2. **Inbox-zero shape** — only render rows the user can act on now; snooze and mute reduce the list; no endless feed.
3. **Agent-native actions** — primary actions kick off new tasks with the right skill (review, fix CI, address comments).
4. **Don't duplicate the task list** — running and failed agent runs surface as a compact strip, not as attention rows.
5. **Three views of the same data** — a triage **list** (severity-first), a workflow **board** (stage-first kanban), and a **config** canvas where the user models the workflow that the other two views derive from. Same workstream model, three renderings.
6. **User-configurable workflow** — list sections and board columns are *not* hardcoded for the long run. The user defines the pipeline (steps, conditions, agents attached at each step) on the Config canvas; List and Board are projections of that configuration over the live `HomeSnapshot`. A built-in default workflow matches the v1 hardcoded spec so the feature ships useful on day one.
7. **Host-agnostic architecture** — all aggregation, workflow persistence, and classification in main services; renderer is dumb (yes, even the canvas).

## 3. Non-goals (v1)

- Full Git client or repo browser.
- Re-surfacing what the task panel already shows (running runs, failed runs, agents needing permission).
- Cross-org reporting or an "all users" view.
- Destructive cleanup automation.
- Mirroring GitHub's notifications inbox.
- Slack-origin signals or signal reports with no branch/PR yet — Inbox already handles those.

## 4. Sidebar & navigation

**Sidebar order:** New task, **Home**, Search, Inbox, Skills, MCP Servers, Command Center, task list.

**Default landing view:** Home if the user has ≥1 workspace, otherwise New task.

**Implementation:**

- Add `"home"` to `ViewType` in `apps/code/src/renderer/stores/navigationStore.ts:24`.
- Add `navigateToHome` action.
- **Rename** existing `apps/code/src/renderer/features/sidebar/components/items/HomeItem.tsx` (which currently exports `NewTaskItem` and `InboxItem`) before this feature lands. New `HomeItem.tsx` owns the Home sidebar entry.
- Add a `Home` arm to the view switch in `apps/code/src/renderer/components/MainLayout.tsx`.
- Keep using the existing `navigationStore`; no second router introduced.

## 5. Core model

```ts
type HomeSnapshot = {
  generatedAt: string
  summary: { needsAttention: number; inProgress: number; watching: number }
  activeAgents: ActiveAgentSummary[]    // compact strip; see §6
  workstreams: HomeWorkstream[]
}

type HomeWorkstream = {
  id: string                    // PR URL → repo#branch → worktreePath → taskId
  repository: { path?: string; owner: string; name: string } | null
  branch: string | null
  baseBranch: string | null
  pr: HomePullRequest | null
  tasks: HomeTaskSummary[]      // sorted newest first; count shown, latest expanded
  attention: HomeAttentionItem[]
  state: "attention" | "in_progress" | "watching"
  lastActivityAt: string
  lastUserViewedAt: string | null
}

type HomeAttentionItem = {
  id: string
  kind:
    | "pr_review_requested"
    | "pr_comments"
    | "pr_ci_failed"
    | "pr_ready_to_merge"
    | "stale_no_pr"
    | "branch_cleanup"
  severity: "critical" | "attention" | "quiet"
  source: "git" | "github"
  title: string                 // "CI failed on test:e2e"
  detail: string                // one-line context
  primaryActionId: string
  secondaryActionIds: string[]
  snoozedUntil: string | null
  mutedAt: string | null        // cleared on next state change
  mutedAtSha: string | null     // anchor for "next change" detection
}

type HomePullRequest = {
  url: string; number: number; title: string
  state: "open" | "draft" | "merged" | "closed"
  mergeable: boolean | null
  ciStatus: "passing" | "failing" | "pending" | "none"
  unresolvedThreads: number
  newCommentsSinceViewed: number
  reviewDecision: "approved" | "changes_requested" | "review_required" | null
  isCurrentUserRequestedReviewer: boolean
  isCurrentUserAuthor: boolean
  lastUpdatedAt: string
}

type ActiveAgentSummary = {
  taskId: string
  taskRunId: string
  title: string
  branch: string | null
  prUrl: string | null
  startedAt: string
  // Status comes directly from TaskRun; no Home-side classification.
  status: "queued" | "in_progress"
}
```

### Workflow configuration model

The Config canvas persists a `WorkflowConfig` that the List and Board views project over the snapshot. The model lives in main; the renderer reads it via tRPC. A built-in default `WorkflowConfig` (matching the §6.3 hardcoded board columns) ships with the app and is used until the user customises it.

```ts
type WorkflowConfig = {
  id: string
  version: number              // bumps on every save; enables optimistic concurrency
  updatedAt: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  layout: Record<NodeId, { x: number; y: number }>  // canvas positions, opaque to main
}

type WorkflowNode =
  | { id: NodeId; kind: "input"; label: string; inputType: "pr_url" | "branch" | "task_prompt" }
  | { id: NodeId; kind: "task"; label: string; skillId: string | null }
  | { id: NodeId; kind: "step"; label: string; match: WorkflowMatch; agents: AgentBinding[] }
  | { id: NodeId; kind: "queue"; label: string; queueKind: "stale" | "merge" | "cleanup"; match: WorkflowMatch; agents: AgentBinding[] }
  | { id: NodeId; kind: "branch"; label: string; condition: WorkflowCondition }
  | { id: NodeId; kind: "terminal"; label: string; terminalKind: "merged" | "closed" | "archived" }

type WorkflowEdge = {
  id: EdgeId
  from: NodeId
  to: NodeId
  // Edge fires when the source node's condition resolves to this case (e.g. "ci_failed", "approved").
  whenCase: string | null
}

// Declarative predicate; main evaluates it against a HomeWorkstream.
type WorkflowMatch = {
  hasPr?: boolean
  prState?: ("open" | "draft" | "merged" | "closed")[]
  ciStatus?: ("passing" | "failing" | "pending" | "none")[]
  reviewDecision?: ("approved" | "changes_requested" | "review_required")[]
  hasUnresolvedComments?: boolean
  isStale?: { olderThanHours: number }
  // Extend as needed; the renderer never interprets this directly.
}

type WorkflowCondition =
  | { kind: "ci_status" }       // cases: "passing" | "failing" | "pending"
  | { kind: "review_decision" } // cases: "approved" | "changes_requested" | "review_required"
  | { kind: "pr_state" }        // cases: "open" | "draft" | "merged" | "closed"

type AgentBinding = {
  id: string
  label: string                 // "Fix CI", "Address comments"
  skillId: string               // resolved against the skills registry in main
  promptTemplate: string        // mustache-style; main fills `{{prUrl}}`, `{{branch}}`, etc.
  trigger: "primary" | "secondary" | "auto"  // "auto" runs as soon as a workstream lands in this node
}
```

**Classification (main only).** `HomeService` walks each workstream against the workflow's nodes in declaration order and assigns it to the first matching `step` / `queue` node. The result is a `nodeId` per workstream, stored on the snapshot — the renderer never re-evaluates predicates. This keeps `WorkflowMatch` as a private main-side language.

**Workstream grouping key precedence:** PR URL → `repo + branch` → worktree path → task id.

**Note: no `run_failed` or `agent_needs_input` kinds.** Failed runs, cancelled runs, and runs awaiting permission are already obvious in the task panel. Home does not surface them as attention rows. If they materially affect downstream state (e.g. a failed run left a branch with no PR for >24h), the *branch* surfaces as `stale_no_pr` — the user-facing reason, not the agent-side cause.

## 6. UI layout

Home renders three views over the same `HomeSnapshot` + active `WorkflowConfig`. The user picks one with a persistent toggle in the header; data, actions, and empty states are consistent across views — only the layout and density differ.

- **List view (default)** — triage-first. Two sections (Needs attention / In progress) sorted by severity and recency. Best for "what should I do next?".
- **Board view** — workflow-first kanban. One column per `step`/`queue` node in the active workflow, left → right. Best for "where is everything in the pipeline?".
- **Config view** — drag-and-drop canvas where the user authors the workflow that List and Board project over. Best for "how does *my* work actually flow?".

A piece of work belongs to a single bucket in list/board: the list assigns it to a *section* by severity, the board assigns it to a *column* by the workflow node it matched. Same `HomeWorkstream`, two derivations of the same workflow.

### 6.1 Shared chrome (both views)

**Header:** title `Home`, summary line (`3 need attention · 2 running · 4 watching`), repo chip (default: current repo), **view toggle** (`List` / `Board`), refresh button.

**Strip — Active agents.** Horizontal, compact, glanceable. One small card per `in_progress` or `queued` TaskRun.

- Task title, branch chip, elapsed timer, skill icon.
- Click → opens the task detail view (same as clicking it in the task panel).
- This strip is **information, not attention**. It never gets a count badge, never blocks empty state. Hidden entirely when no agents are running.
- The strip lives at the top in **both** views. Agents are a transient activity feed; workstreams are persistent. They run on different timescales, so they don't share visual real estate with the buckets.

**Detail pane** (two-pane, like Inbox): workstream header → PR header (state, CI, reviewers) → attached task runs (clickable to their detail view) → unresolved comments preview → action bar (`SkillButtonsMenu` shape). The detail pane is shared between views — selecting a row in list or a card on the board opens the same panel.

**Keyboard:** `j`/`k` move, `Enter` primary action, `s` snooze, `m` mute, `o` open in browser, `r` refresh, `v` toggle list/board.

**Empty states:**

- Zero attention, no agents running: "You're caught up." + summary chips.
- Zero attention, agents running: strip is visible, sections/columns empty + "Everything else is healthy."
- No GitHub auth: degraded mode (local Git signals only) + CTA to connect.
- No workspaces: redirect to New task.

### 6.2 List view

**Section 1 — Needs attention.** Only rows where `state === "attention"`. Sorted by severity, then last activity. Multiple attention items on one workstream stack as chips on the row; top-severity drives the primary action.

**Section 2 — In progress.** Workstreams with recent activity but no outstanding attention item (e.g. PR open, draft, CI green, no comments waiting on you). Collapsed by default when Section 1 is non-empty.

**Section 3 — Watching.** *Not a section — a counter pill in the header.* Click expands an overlay: snoozed items, PRs awaiting external reviewers, items in pending CI. Never a default list of rows.

**Row anatomy.**

- Left: workstream title (PR title or branch), repo+branch metadata, attention chips.
- Middle: PR state pill (open/draft/merged), CI dot, task-run count if >1.
- Right: primary action button (split-button with overflow), timestamp.
- Severity-tinted left border: red (critical) / amber (attention) / none (quiet).

### 6.3 Board view

**Columns are workflow-derived.** One column per `step` / `queue` node in the active `WorkflowConfig`, ordered by topological-sort over the edges (left = inputs, right = terminals). The mapping `workstream → column` is the `nodeId` already assigned by `HomeService` (see §5 Classification); the renderer does *not* re-evaluate predicates.

**Default workflow (shipped pre-customisation):**

| Column | Backing node | Contains | Empty placeholder |
|---|---|---|---|
| **No PR yet** | step `no_pr` | `stale_no_pr`; or any workstream with a branch but no PR and no other attention | "Nothing here" |
| **In review** | step `in_review` | PR open or draft with no attention items — awaiting external reviewer or CI | "Nothing here" |
| **Needs me** | step `needs_me` | `pr_ci_failed`, `pr_comments`, `pr_review_requested` | "Nothing here" |
| **Ready to merge** | queue `merge_queue` | `pr_ready_to_merge` | "Nothing here" |
| **Cleanup** | queue `cleanup` | `branch_cleanup` | "Nothing here" |

A workstream belongs to exactly one column — the first node whose `match` predicate it satisfies, walked in declaration order. The default config encodes today's resolution order (`cleanup` → `merge_queue` → `needs_me` → `no_pr` → `in_review`). Once the user edits the workflow in the Config view, this default is replaced; the renderer doesn't know or care.

**Card anatomy** (denser than a row):

- Title (line-clamp-2), CI status icon top-right.
- Repo, branch chip, PR `#number`, relative time.
- Attention chips (abbreviated: `Review` / `CI` / `Feedback` / `Mergeable` / `Stale` / `Cleanup`).
- Author chip when it's someone else's PR (`by @user`).
- Review decision line ("Changes requested" / "Approved") when relevant.
- One-line summary from the top attention.
- Primary action button + task count if >1.
- Severity-tinted left border, same colour scheme as the list rows.

**Empty columns render a dashed "Nothing here" placeholder.** Important for kanban scanning — the user should be able to glance and see *which stage is empty*, not just *which stage is full*.

**Why kanban as well as list:** PRs move through a fixed workflow. The list is great when you're doing inbox-zero triage ("what should I act on first?"). The board is great when you're doing a status review ("how many things are stuck in review? what's about to ship?"). Same data, different question.

### 6.4 Config view

A drag-and-drop canvas where the user models their workflow. The canvas is the *only* heavy frontend surface in Home; everything that touches data still goes through main per R1/R2.

**What you can build.**

- **Input nodes** — entry points for new work. Examples: "Paste a PR URL", "Start from a task prompt", "Pick a branch". When the user triggers an input, it creates or attaches a workstream.
- **Task nodes** — kick off a new agent task with a chosen skill. Used as starting nodes (user-initiated) or as transition handlers (the next-step agent in a chain).
- **Step nodes** — workflow stages a workstream sits in (e.g. `In review`, `Needs me`). Each step has a `match` predicate and zero-or-more `AgentBinding`s that surface as quick actions on the List/Board row when a workstream lands there.
- **Queue nodes** — like steps but visually distinct on the board (e.g. `Stale queue`, `Merge queue`, `Cleanup`). Same predicate model.
- **Branch nodes** — split the flow by a condition (e.g. `CI status` → `passing` / `failing` / `pending`). Outgoing edges declare which case they handle via `whenCase`.
- **Terminal nodes** — `merged`, `closed`, `archived`. Workstreams that match a terminal disappear from List/Board.

**Worked example (matches the user's brief):**

```
[Input: PR URL]                                  ┐
                                                  ├──► [Step: PR open]──► [Branch: CI status]
[Task: "Create a PR" (skill: create-pr)] ──────────                              │
                                                                                 ├─ failing ──► [Step: Needs me] ─► [Agent binding: "Fix CI"]
[Step: No PR yet] ──► [Branch: PR exists?]                                       │
                       └─ no ──► [Queue: Stale queue]                            ├─ pending ──► [Step: In review]
                                                                                 │
                                                                                 └─ passing ──► [Branch: review_decision]
                                                                                                  ├─ changes_requested ──► [Step: Needs me] ─► [Agent: "Address comments"]
                                                                                                  ├─ review_required   ──► [Step: In review]
                                                                                                  └─ approved          ──► [Queue: Merge queue] ─► [Terminal: merged]
```

The board renders one column per step/queue node in the order above; the list renders the same nodes as severity-banded sections (severity inferred from each node's attention kinds).

**Canvas UI behaviour.**

- Pan / zoom / fit-to-content; minimap toggle.
- Sidebar palette of node types — drag onto canvas to add.
- Click a node → inspector panel on the right: label, match predicate builder, attached `AgentBinding`s (skill picker + prompt template editor with `{{prUrl}}` / `{{branch}}` / `{{failingChecks}}` placeholders).
- Click an edge → set `whenCase` from the source branch node's case list.
- Validation surfaces inline: orphan nodes, unreachable terminals, duplicate `whenCase` on a branch's outgoing edges, predicates that overlap a higher-priority node. Validation runs in main (the canvas only renders the diagnostics).
- **Save model: explicit, not auto.** A dirty banner appears once the user changes anything; "Save" submits the whole workflow; "Discard" reverts to the persisted version. No silent autosave — workflow edits drive every other Home surface, so an accidental save would be loud.
- Versioned saves with optimistic concurrency: if the persisted `version` has advanced (e.g. another window edited it), the save mutation rejects and the canvas offers reload or force-overwrite.

**Architecture (heavy frontend, but the rules still hold).**

Per R1 / R2 / R3: even though the canvas is the most visually expensive surface in the app, no business logic lives in the renderer.

- **`WorkflowService` (main).** Thin authenticated client over `/code_workflow/*`: reads/writes the canonical `WorkflowConfig` and emits `workflow.onChanged`. The config endpoint is the only source of truth — load failures propagate so the canvas can show an offline/error state, never a fabricated config. Persistence, version bumps, validation, the default seed, and classification all live server-side in PostHog.
- **tRPC `workflow.*` router (main).** One-liners only: `workflow.get` (query, returns `WorkflowConfig`), `workflow.save` (mutation, `{ config, expectedVersion }` → new version or `ConflictError`), `workflow.resetToDefault` (mutation), `workflow.onChanged` (subscription, `WorkflowConfig` diff stream).
- **`useWorkflow` (renderer hook).** Single `useQuery` against `workflow.get`, kept fresh by the subscription registrar in `features/home/subscriptions.ts` per R9. No multi-query orchestration in the hook.
- **`workflowEditorStore` (renderer Zustand, R2-clean).** Holds *only* uncommitted edit state: `viewport: { x, y, zoom }`, `selectedNodeId`, `selectedEdgeId`, `draftConfig` (deep-clone of the persisted config the moment editing starts), `dirty`, `validationErrors` (fed from main on each draft change via `workflow.validateDraft`). The persisted `WorkflowConfig` is *not* in this store — it's the `useQuery` result. Save action is one `useMutation` call; the store's job ends there.
- **`workflowCanvasService` (renderer service, R3 escape hatch).** Drag-and-drop coordinator, snap-to-grid maths, hit-testing, edge-routing — the exact "non-trivial renderer-only UI mechanic shared across components" R3 carves out. No data fetching, no cross-store reach-ins.
- **Components (`features/home/config/`).** `ConfigCanvas.tsx`, `NodePalette.tsx`, `NodeInspector.tsx`, `EdgeInspector.tsx`, `ValidationBanner.tsx`. Components consume the `useWorkflow` query for the persisted state and the editor store for the draft.
- **Cross-feature coordination (R5).** `WorkflowService` emits `WorkflowChanged`; `HomeService` reacts by re-classifying and pushing a new `home.onSnapshotUpdated` frame. The renderer's List and Board re-render off the new snapshot. No store ever reaches across to another store.
- **Library choice.** Use [`@xyflow/react`](https://reactflow.dev/) for the canvas primitive (pan / zoom / nodes / edges / minimap). It's the lightest mainstream option and the canvas state it owns is fine to keep local-to-component — we don't lift its internal state into the store. Wrap it once so the renderer service can layer our snap/validation behaviour.

**Empty / new-user state.** Until the user touches Config, they see the default workflow on the canvas (read-only outline + "Customise" CTA). After customisation, "Reset to default" is always one click away in the header.

**Keyboard:** `Cmd+S` save, `Cmd+Z` / `Cmd+Shift+Z` undo/redo within the draft, `Delete` / `Backspace` remove selected node or edge, `Esc` clears selection, `v` exits to last non-config view.

### 6.5 View persistence

The user's choice persists across sessions via `homeUiStore.viewMode: "list" | "board" | "config"`. Default for new users is `list` (the inbox-zero shape we open with). Toggle is keyboard-accessible (`v` cycles `list → board → config → list`).

## 7. Data sources

The snapshot is assembled **server-side in PostHog** (`products/tasks/`, see
[docs/workflow-architecture.md](./workflow-architecture.md)) — the Electron app
reads the finished snapshot over the REST API and renders it; it does not
aggregate these sources itself.

| Source | Data |
|---|---|
| Tasks / task runs | status, branch, PR URL; the live active-agent set |
| GitHub PR metadata | title, state, draft, mergeable, CI rollup, review decision, unresolved threads, requested reviewers |
| GitHub review requests | PRs where the current user is a requested reviewer |

Snooze / mute / viewed (`home_attention_state`) is not implemented yet — see
[docs/workflow-architecture.md](./workflow-architecture.md) §4.

## 8. Architecture

The data layer — workstream grouping, PR polling, and situation classification —
runs **server-side in PostHog** (`products/tasks/`, a Temporal worker). The
Electron app is a thin authenticated client. Full server design and wire shapes:
[docs/workflow-architecture.md](./workflow-architecture.md).

**Data layer (`packages/api-client` + `packages/ui` hooks)** — thin clients over
the REST API, no local persistence and no `gh` polling:

- `posthog-client.ts` (`getHomeSnapshot`/`refreshHomeSnapshot`) — project-scoped authenticated fetch of `GET /code_home/`; the snapshot query polls it and validates with Zod.
- `posthog-client.ts` (`getCodeWorkflow`/`saveCodeWorkflow`/`resetCodeWorkflow`) — reads/writes the workflow config via `/code_workflow/*`; load failures propagate so the canvas shows an offline/error state rather than a fabricated config. Save/reset mutations write the fresh config back into the query cache.

Wire shapes (Zod, the shared source of truth for the UI types):
`packages/core/src/home/schemas.ts`, `packages/core/src/workflow/schemas.ts`,
`packages/core/src/home/prSnapshot.ts`.

**UI (`packages/ui/src/features/home/`)**

- `components/` — `HomeView`, `HomeActiveAgentsStrip`, `HomeWorkstreamRow`, `HomeWorkstreamCard`, `HomeBoardView`, `HomeWorkstreamDetailPanel`, `HomeEmptyState`.
- `config/` — the workflow editor (`ConfigMap` and friends).
- `utils/boardColumns.ts` — pure projection of the snapshot into board columns. No I/O, no React.
- `hooks/useHomeSnapshot.ts`, `hooks/useWorkflow.ts` — one `useQuery` each; the snapshot query polls on an interval and the workflow mutations write back through the same query key.
- `stores/homeUiStore.ts` — UI state only (view mode, selection). `stores/workflowEditorStore.ts` — the uncommitted editor draft only.

Situation classification is authoritative on the server, including the
`primarySituation` (the priority pick used for board column placement and
accents) which arrives on each workstream in the snapshot. The renderer never
re-derives situations or the primary from PR state — it reads `primarySituation`
directly and uses `situations` only to render the extra chips.

**Rules honoured:** R1 (main owns the client + orchestration), R2 (stores are UI state + subscription caches only), R4 (one `useQuery` per surface), R5 (main emits `workflow.onChanged`; Home reacts via its subscription registrar), R6 (Zod everywhere, inferred types), R9 (subscriptions registered once at boot), R10 (router one-liners).

## 9. PR data

PR metadata (state, draft, mergeable, CI rollup, review decision, unresolved
threads, requested reviewers) is fetched **server-side** by the PostHog worker
via `GitHubIntegration.get_pull_request_snapshot` — the Electron app does not
poll `gh` for the home tab. The serialised shape is `PrSnapshot`
(`shared/types/pr-snapshot.ts`).

## 10. Polling & rate-limit strategy

- **Server worker** keeps PR snapshots fresh: a Temporal schedule fans out a per-team evaluation every ~3 min that polls each tracked PR (GitHub GraphQL via the team integration, rate-limit aware) and rebuilds the workstreams.
- **Client** just pulls the latest snapshot: `HomeService` polls `GET /code_home/` on a fixed cadence and emits `home.onSnapshotUpdated` on change; `home.refresh` triggers an on-demand server evaluation. No `gh` calls, no rate-limit handling in the app.
- Active agents stream from the existing cloud-task SSE, not from polling.

## 11. Classification & ranking

**Attention kinds → severity:**

| Kind | Severity |
|---|---|
| `pr_ci_failed` | critical |
| `pr_review_requested` (on me) | attention |
| `pr_comments` (unresolved, not by me) | attention |
| `pr_ready_to_merge` | attention |
| `stale_no_pr` | quiet |
| `branch_cleanup` (merged/closed but worktree lingering) | quiet |

**Stale thresholds (constants in `home/service.ts`):**

- Completed run with diff on a branch and no PR: 24h → `stale_no_pr`.
- Branch/worktree with no activity and no PR: 3 days → `stale_no_pr` (escalated severity).
- Merged/closed PR with worktree still around: 1 day → `branch_cleanup`.

**Row ordering inside "Needs attention":** severity → ownership (mine first) → staleness → `lastActivityAt`.

## 12. Actions (registry-driven)

| Situation | Primary | Secondary |
|---|---|---|
| `stale_no_pr` | Create PR | Resume with agent, Open changes, Archive |
| `pr_ci_failed` | Fix CI with agent | Open checks, Open PR |
| `pr_comments` | Address comments with agent | Open review thread, Open PR |
| `pr_review_requested` | **Review with agent** | Open PR, Snooze |
| `pr_ready_to_merge` | Open PR | Ask agent for final check |
| `branch_cleanup` | Archive task & worktree | Open PR |

Agent actions prefill the task input with structured context (PR URL, branch, failing-check summary, unresolved-comment list, suggested skill id) and reuse `TaskCreationSaga` + `sendPromptToAgent`.

Action descriptors are data, not hardcoded buttons. The registry maps `actionId → { label, icon, run: (workstream) => Effect }` and lives in `HomeService` so it remains serializable across the IPC boundary.

## 13. The code-review skill (keystone, ships with M3)

The existing `code-review` feature in `packages/ui/src/features/code-review/` only handles *responding* to PR comments inside an active task. We need a new marketplace skill `code-review` that:

- Takes a PR URL as input.
- Checks out the PR into a fresh worktree.
- Runs a structured review: scope, risk areas, tests, security, style.
- Posts a single review with inline comments via `gh pr review`.
- Lives at `apps/code/skills/code-review/` so it loads through the existing `readSkillMetadataFromDir` discovery.

This is a blocker for M3, not an open question.

## 14. Snooze, mute, viewed

- **Snooze** — hide until `now + N hours`. Default 24h; options 1h/4h/1d/3d.
- **Mute** — hide until the underlying state changes (new commit on the branch, new comment, CI flip, reviewer change). Cleared automatically by `HomeService` when the watermark moves.
- **markViewed** — updates `lastUserViewedAt`; powers `pr.newCommentsSinceViewed`.

Persistence (`home_attention_state`) is server-side and not implemented yet — see [docs/workflow-architecture.md](./workflow-architecture.md) §4.

## 15. Analytics events

- `home_viewed` (viewMode: list | board)
- `home_view_mode_changed` (from, to)
- `home_attention_action_clicked` (kind, actionId, viewMode)
- `home_attention_snoozed` (kind, durationHours)
- `home_attention_muted` (kind)
- `home_action_started_task` (kind, skillId)
- `home_refresh_requested` (reason: manual | visible | poll)
- `home_active_agent_clicked` (taskId)
- `home_config_opened`
- `home_config_workflow_saved` (nodeCount, edgeCount, agentBindingCount, version)
- `home_config_workflow_reset_to_default`
- `home_config_node_added` (nodeKind)
- `home_config_validation_blocked_save` (errorCount)

Follow naming conventions in `docs/conventions.md`.

## 16. Phasing

### M1 — Skeleton (no new I/O)

- Home route, sidebar entry, view scaffold.
- `HomeService.getSnapshot` built from existing `useTasks` data + `WorkspaceService` state piped to main.
- **Active agents strip** wired to existing `CloudTaskService` stream (zero new infra).
- Kinds that work without new `gh` calls: `stale_no_pr`.
- **List and board ship together with the built-in default workflow.** No editor yet. The board reads the built-in default `WorkflowConfig` (`workflow/default-workflow.ts`); no server round-trip needed at this stage. Column projection lives in `utils/boardColumns.ts`.
- Ships visible value immediately and validates the layout.

### M2 — PR enrichment

- Server-side PR enrichment: the worker polls each tracked PR and serialises a `PrSnapshot`.
- New kinds: `pr_ci_failed`, `pr_comments`, `pr_ready_to_merge`, `branch_cleanup`.
- PR row UI; refresh button.

### M3 — Reviewer flow + code-review skill

- `pr_review_requested` kind (PRs where the user is a requested reviewer).
- **Ship the `code-review` skill in this same milestone.**
- "Review with agent" action wired through `TaskCreationSaga`.

### M4 — Inbox-zero controls

- Snooze, mute, `lastUserViewedAt`, keyboard shortcuts (`j`/`k`/`s`/`m`/`Enter`).
- Server-side `home_attention_state` for snooze/mute/viewed.

### M5 — Config canvas (workflow editor)

- `WorkflowService` client + server-side workflow config persistence (`code_workflow/*`); the default workflow is seeded server-side on first read.
- `workflow.*` tRPC router with Zod schemas.
- Renderer: `ConfigCanvas`, palette, inspectors, validation banner.
- `workflowEditorStore` + `workflowCanvasService` (R3 escape hatch).
- `WorkflowChanged` event flow into `HomeService` so List/Board re-render on save.
- Agent bindings on step/queue nodes drive primary/secondary actions in the action registry (replaces the M2 hardcoded action table).
- View toggle becomes three-way; `v` keyboard cycle updated.

### M6 — Polish

- Multi-repo chip, GitHub integration toggle.
- Optional native notifications on critical kinds (opt-in).
- Settings (stale thresholds, polling cadence).
- Workflow templates (share-and-import a `WorkflowConfig` JSON).

## 17. Implementation checklist

**M1–M4 (List + Board with built-in default workflow):**

- [ ] Rename existing `HomeItem.tsx` to free the filename.
- [ ] Add `home` to `ViewType` + `navigateToHome`.
- [ ] Scaffold `HomeService` (REST client), schemas, router, DI token, root router wiring.
- [ ] Add the built-in default `WorkflowConfig` (`workflow/default-workflow.ts`); `WorkflowService` falls back to it when offline.
- [ ] Server-side `home_attention_state` for snooze/mute/viewed.
- [ ] `HomeService` poll loop → `home.onSnapshotUpdated`, kept fresh by the subscription registrar.
- [ ] M2: server-side PR enrichment; `home.refresh` triggers an on-demand evaluation.
- [ ] M3: `code-review` skill in `apps/code/skills/code-review/`.
- [ ] Renderer: `useHomeSnapshot` (query + subscription), `HomeView`, active-agents strip, row + card components, board view, view toggle in header, detail pane, empty states.
- [ ] `utils/boardColumns.ts` — column projection from `(workflow, snapshot) → BoardColumn[]` + unit tests covering every attention combination.
- [ ] `homeUiStore.viewMode` persistence + `v` keyboard shortcut for toggle.
- [ ] Action registry + `home.startAction` dispatcher (link to `TaskCreationSaga` / `sendPromptToAgent` / urlOpener).
- [ ] Analytics events (include `home_view_mode_changed`).
- [ ] Tests: workstream grouping, column projection, staleness classification, severity ranking, snooze/mute decay, action prompt builders.
- [ ] Component tests for empty / caught-up / heavy states **in both list and board layouts**.

**M5 (Config canvas):**

- [ ] `WorkflowService` client (default workflow, `workflow.onChanged` event) + server-side workflow config persistence.
- [ ] `workflow.*` tRPC router with Zod input/output schemas (`get`, `save`, `validateDraft`, `resetToDefault`, `onChanged`).
- [ ] `useWorkflow` hook (query + subscription); subscription wired in `features/home/subscriptions.ts`.
- [ ] `workflowEditorStore` (Zustand, UI-only) + `workflowCanvasService` (R3 escape hatch for drag/snap/hit-test).
- [ ] Components: `ConfigCanvas`, `NodePalette`, `NodeInspector`, `EdgeInspector`, `ValidationBanner`.
- [ ] Three-way view toggle + `v` cycle + `Cmd+S` save + undo/redo within draft.
- [ ] `WorkflowChanged` → `HomeService.reclassify()` → new snapshot frame; both List and Board update without any renderer-side coordination.
- [ ] Agent bindings drive primary/secondary action registry (replaces the M2 hardcoded mapping in §12).
- [ ] Tests: workflow Zod round-trip, predicate evaluation (matching `boardColumns` expectations against the default config), validation diagnostics, optimistic-concurrency reject + reload, draft → save → snapshot reclassification end-to-end.

## 18. Open questions

1. Should Home replace Command Center, given overlap on "see all running tasks"? Probably not — Command Center is a grid-of-agents work view, Home is workstream-grouped triage — but confirm.
2. When a PR has both `pr_ci_failed` and `pr_comments`, do we stack chips on one row (current spec) or split into two attention items? Current: stack, single row, primary action follows top severity.
3. Which GitHub identity wins when both the GitHub integration and `gh` auth are present? Suggestion: `gh` for queries, GitHub integration for permission checks.
4. Should "Review with agent" auto-checkout into a new worktree or reuse the user's current one with a stash? Suggestion: new worktree, always.
5. Cross-device snooze sync? v1: local only.
6. Native OS notifications on critical kinds? Defer to M5; opt-in.
7. Should the board support drag-to-move between columns? Current answer: **no for v1**. Columns are derived from underlying state, not user-set status — dragging would either need an override store (extra concept, sync complexity) or have to perform the underlying action (e.g. "drag to Ready to merge" = merge the PR), which is too consequential for a drag gesture. Default: cards are read-only with explicit action buttons.
8. Should the board surface snoozed and muted items in a "Watching" column, or keep the list view's behaviour (counter pill only, not a column)? Current answer: **counter pill only**. Adding a sixth column dilutes the workflow story — Watching items aren't a workflow stage.
9. Default view for new users — list or board? Current answer: **list**. Inbox-zero shape is what we open with; the board reveals itself via the toggle.
10. Should the Config canvas be per-user, per-repo, or per-project? Current answer: **per-user, global**. Cross-repo workflows are the same shape ("PR → review → merge") so a single workflow keeps the model simple. Revisit if teams ask for per-repo overrides.
11. Are workflow edits live for everyone in the org, or local? Current answer: **local for v1**. Sync via PostHog API is M6+.
12. Should `terminal: archived` automatically run the existing archive action when a workstream lands there? Current answer: **no for v1**. Terminals just hide the workstream from List/Board; actions stay user-initiated.
13. Should the canvas render the *live* workstreams (a count chip on each node) so it doubles as a board? Current answer: **yes for v1, read-only chips only**. Helps the user understand what their workflow is doing without making the canvas a third board.
14. Library: `@xyflow/react` vs roll our own. Current answer: **`@xyflow/react`**. Pan/zoom/edge routing is enough work that "prefer writing our own" doesn't apply; wrap it once so we can swap later.
