# Canvas (Website space) — patterns

Conventions for the channel-scoped Website space: channels, dashboards, and the
gen-UI canvas. Read this before changing breadcrumbs, dashboard naming, or the
canvas generation harness. The root `AGENTS.md` architecture rules still apply.

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

## Dashboard naming

- **The dashboard's H1 is its name.** The canvas harness always emits a top-level
  `Heading` (level 1) as the first child of the root `Page`
  (see `CANVAS_SYSTEM_PROMPT` in `genui/catalog.ts`). `dashboardTitleFromSpec`
  (`genui/dashboardTitle.ts`) reads that H1.
- **Editing the H1 renames the dashboard.** On save, the derived title is passed
  as the dashboard `name`; there is no separate name field or rename UI.

## Storage

- Dashboards are **backed by the PostHog desktop file system**, not local files.
  A dashboard is a `dashboard`-typed row nested under its channel folder; its
  name is the last path segment (the H1) and the json-render spec rides in
  `meta.spec`. See `@posthog/core/canvas/dashboardsService.ts`; the `meta` payload
  is typed + documented as `DashboardFileMeta` in `dashboardSchemas.ts`. This
  keeps dashboard and channel names in sync with the backend — the same surface
  that owns channels (top-level `folder` rows, see `hooks/useChannels.ts`).
- `meta.spec` is **last-write-wins, unversioned**. A polling refresh and a
  concurrent edit elsewhere can clobber each other (no `base_version` on `meta`).
  Acceptable for now; revisit with optimistic concurrency / versioning if
  multi-client editing becomes real.
