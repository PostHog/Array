# Canvas / Dashboards — Progress & MVP gaps

Branch: `feat/canvas`. Generative-UI dashboards built from real PostHog data,
wrapped in a Slack-like multi-space shell.

## What's built

### Shell / navigation

- **Canvas nav rail** (`features/canvas/components/CanvasNav.tsx`) — Slack-like
  left rail of square Quill buttons: **Home**, **Inbox**, **Code**. Reserves
  macOS traffic-light space; draggable titlebar region.
- **Inbox** — top-level `/inbox` renders `InboxView` full-screen (no code
  chrome); rail button shows a live count badge.
- **Home space** (`/`) — own `HomeSidebar` with Quill folder collapsibles and
  Quill nav buttons. Website section: Dashboards (with count badge), New
  dashboard, New task, Settings, and the list of created tasks.
- Root layout (`routes/__root.tsx`) branches: settings (full-screen),
  inbox (full-screen), home space (rail + HomeSidebar), code (existing chrome).
  Home-space detection centralized in `features/canvas/spaces.ts`.

### Website space (`/website/*`, layout in `WebsiteLayout.tsx`)

- Breadcrumb topbar: `Website > [crumb]` + right-aligned controls.
- **New task** — reuses `/code`'s `TaskInput` via its `onTaskCreated` seam;
  created tasks route to `/website/tasks/$id` (tracked in
  `websiteTasksStore`, persisted) and render with the reused `TaskDetail`.
- **Settings** — inert placeholder.

### Dashboards (file-backed json-render)

- **Main `DashboardsService`** (`main/services/dashboards/`) — each dashboard is
  a JSON file (`{id, name, spec, createdAt, updatedAt}`) under
  `<appData>/dashboards/`. tRPC `dashboards.list | get | create | update`.
- Dashboard route renders the saved json-render **spec read-only** via
  `CanvasRenderer` (ErrorBoundary-guarded). Empty state when no spec.
- **Combobox switcher** in the breadcrumb (filtering disabled so all show).
- **Edit mode** (per-dashboard toggle) swaps the view for the **gen-UI canvas +
  chat** for that dashboard's thread.
- **Save** (enabled only when the live spec differs from saved) writes the spec;
  **Save as fork** copies the current spec into a new dashboard; **New
  dashboard** / empty-state create a blank one and open it in edit mode.
- **Refresh + polling control** (`DashboardRefreshControl.tsx`) — Quill button
  group `Refresh | ⚙`. Gear dropdown: Static / Polling (10s, 10min). Polling
  counts down in the button ("Refreshing in XX"), pauses in edit mode, and the
  icon spins (`motion-safe:animate-spin`) while fetching.

### Gen-UI engine

- `@json-render/core` + `@json-render/react`. Shared catalog
  (`genui/catalog.ts`: Page/Grid/Card/Heading/Text/Stat/Table/BarList/Badge/
  Divider) → `CANVAS_SYSTEM_PROMPT`. Radix registry in `genui/registry.tsx`.
- **Main `CanvasGenService`** reuses `AgentService` (PostHog MCP auto-enabled)
  via a new `systemPromptOverride`, runs an ephemeral `__preview__` session per
  thread with `bypassPermissions`, forwards ACP updates through a mixed-stream
  parser to assemble the spec, and streams typed events over a tRPC
  subscription. Multi-thread (one per dashboard).
- Renderer: thin multi-thread `canvasChatStore`, scoped subscription registrar,
  `CanvasChat` panel.

## What's left for a real MVP

1. **Live data (biggest gap).** Dashboards store *static* specs — the agent
   bakes numbers in at generation time. Refresh/polling currently just re-reads
   the same file, so it's a visual no-op for saved dashboards. Real MVP needs
   one of:
   - re-run the agent on refresh to regenerate against fresh PostHog data, or
   - json-render **data bindings** + a data-fetch layer the spec references
     (preferred — cheap refresh, no re-generation).
   The refresh/polling UI is already wired for whichever path.
2. **Verify the gen-UI agent end-to-end, live.** Not yet confirmed against a
   real authed project: that the agent reliably emits valid json-render JSONL,
   that PostHog MCP tools auto-approve under `bypassPermissions`, that the
   prose/JSONL split is robust, and that it doesn't flood. May need
   system-prompt tuning or gating the Claude Code file/bash tools off.
3. **Dashboard lifecycle.** No delete. Rename was reverted (dropdown only) —
   add back if needed. Editing starts from a blank canvas rather than seeding
   from the saved spec, so iterating on an existing dashboard restarts.
4. **Website task detail** lacks the code `HeaderRow` actions (branch selector,
   handoff, skill buttons) since that chrome is intentionally absent — add a
   website-space task toolbar if those are needed.
5. **Persistence niceties.** Polling choice is per-mount local state (resets on
   reload); canvas chat threads aren't persisted (lost on reload). Dashboard
   storage path isn't surfaced/configurable.
6. **Tests.** None yet for `DashboardsService`, `CanvasGenService`,
   `canvasChatStore`, or the refresh control.
7. **States & polish.** Loading/error states for the dashboards list and gen-UI
   stream; optional minimum spin duration so instant local refreshes still read
   as deliberate.

## Dev caveat

Main-process changes (new services/routers: `dashboards`, `canvas-gen`,
`AgentService` edits) require a **full dev restart** — renderer HMR won't load
them. Symptom when stale: `No "mutation"-procedure on path "dashboards.create"`.
