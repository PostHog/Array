# Canvas (Website space) — patterns

Conventions for the channel-scoped Website space: channels and canvases. A canvas
is an agent-authored single-file React app rendered in a sandboxed iframe. Read
this before changing breadcrumbs, canvas naming, or the canvas generation harness.
The root `AGENTS.md` architecture rules still apply.

## Spaces & chrome

- Channels is a **top-level space** reached through the app rail (`AppNav`),
  gated behind `project-bluebird` and wired in `routes/__root.tsx`. The rail's
  spaces are Code (`/code`), Inbox (`/inbox`), and Channels (`/website`).
- The Channels space has **its own chrome**: rail + a persistent channel-list
  sidebar (`ChannelsList`, rendered in `__root`) + the `WebsiteLayout` outlet. It
  does NOT use the code `HeaderRow`/`MainSidebar`, so breadcrumbs render in
  `WebsiteLayout`'s own top bar (below).

## Breadcrumbs

- **`WebsiteLayout` renders its own top bar.** The Channels space has no code
  `HeaderRow`, so breadcrumbs (and the dashboard controls) are a local bar inside
  `WebsiteLayout`, not pushed through the header store.
- **A page does not get its own crumb — its H1 is the title.** A view that
  renders its own `<h1>` is NOT repeated as a breadcrumb segment for itself. The
  dashboards grid's h1 is "Dashboards"; a single dashboard's h1 is its name.
- **A parent index IS a crumb when you're on a child, but not when you're on it.**
  - On the grid (`/website/$channelId`): trail is `#channel` only — no
    "Dashboards" crumb (its own h1 covers it, and `#channel` already links here).
  - On a single dashboard (`/website/$channelId/dashboards/$id`): trail is
    `#channel / Dashboards`, where `Dashboards` links back to the grid. The
    dashboard's name is the h1 below, not a crumb.
- Crumbs reflect navigable parents above the current page; the current page is
  the H1, never a crumb of itself.

## Canvas naming

- **A canvas's name is its file-system path segment**, set at creation
  (`Untitled canvas` by default; the template picker / `useCreateAndOpenDashboard`
  drive it) and copied with a `(fork)` suffix on fork. It is independent of any
  heading the agent renders inside the React app.

## Storage

- Canvases are **backed by the PostHog desktop file system**, not local files.
  A canvas is a `dashboard`-typed row nested under its channel folder; its name
  is the last path segment. The agent-authored React source + edit history ride
  in `meta` (`code`, `versions`, `currentVersionId`, `context`, `templateId`).
  See `@posthog/core/canvas/dashboardsService.ts`; the `meta` payload is typed +
  documented as `DashboardFileMeta` in `dashboardSchemas.ts`. This keeps canvas
  and channel names in sync with the backend — the same surface that owns
  channels (top-level `folder` rows, see `hooks/useChannels.ts`).
- `meta` is **last-write-wins, unversioned** at the fs layer (no `base_version`).
  Freeform autosaves the whole file each agent turn, so a concurrent edit from
  another client can clobber. Acceptable for now; revisit with optimistic
  concurrency if multi-client editing becomes real.
