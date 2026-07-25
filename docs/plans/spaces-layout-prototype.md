# Plan: "Spaces" Layout Prototype

Status: draft — for team discussion; scoped as a shareable prototype, not a final architecture.
Surface: Channels space (`/website/*`), behind the existing `project-bluebird` alpha plus one new layout toggle. The default Code experience is untouched.

## The idea (from the mockup)

A new layout organized around **spaces** — Arc-browser-style workspaces you flip between, one per channel:

1. **Spaces switcher.** Channels (`# code`, `# my-playground`, …) become swipeable spaces. A dot row at the bottom of the sidebar switches between them (hover shows the name, `+` = "choose or create a channel → create a new space"). The landing state lists channels; entering one scopes the whole sidebar to it.
2. **Per-space sidebar.** `+ New task` on top, then the channel name, then three nav entries — **Context**, **Loops**, **Artifacts** — that open in the center view, then a **pinned** section (tasks and canvases together), then **recents** (tasks and canvases mixed).
3. **Top bar.** A persistent **Search** field in the middle; an **Activity** bell and an **Inbox** icon on the right — both open in the main view.
4. **Task view as a tabbed container.** One task hosts multiple tabs: `Chat 1 | Terminal | Chat 2 | Canvas | PR 1 | +`. The `+` offers new chat / terminal / canvas — only what actually works today needs to be enabled. Clicking an artifact opens it as a new tab inside the task; the PR tab shows the diff. Composer at the bottom.
5. **Right "Activity" panel** on the task, with three tabs:
   - **Timeline** — explicitly "the same thing we call the thread today, just a different name."
   - **Artifacts** — outputs of/belonging to this task: PRs (with state + comment counts), canvases, the originating Slack thread as an external link. Canvas commenting doesn't exist yet and that's acknowledged.
   - **Comments** — top-level comments on the task itself (`+ Add new`), each showing its source context (general, a canvas, a Slack channel, a PR) and reply count.

## What already exists (mockup → codebase)

The single biggest input to this plan: **most of the mockup's nouns already exist** in the Channels/Bluebird alpha. The prototype is largely re-chroming and generalizing, not net-new systems.

| Mockup element | Today | Where |
| --- | --- | --- |
| `# channel` list, create/star channels | Built (alpha) | `packages/ui/src/features/canvas/components/ChannelsList.tsx`, `CreateChannelModal.tsx`, `hooks/useChannels.ts`, `hooks/useChannelStars.ts` |
| Space-per-channel routing | Built — every per-channel section already has a route | `/website/$channelId/{context,loops,artifacts,history}` under `packages/ui/src/router/routes/website/` |
| Context nav entry | Built, labeled "CONTEXT.md", as an in-channel header tab | `WebsiteContext.tsx`, `channelSections.ts`, `ChannelTabs.tsx` |
| Loops nav entry | Built (global + per-channel) | `WebsiteChannelLoops.tsx`, `/code/loops` |
| Artifacts nav entry (channel level) | Built — canvases + PRs union | `WebsiteChannelArtifacts.tsx` |
| Recents (tasks + canvases mixed) | Built, as the "Recents" channel tab | `WebsiteChannelHistory.tsx` |
| Pinned items | Three separate systems: pinned tasks (global), pinned canvases (per channel), starred channels | `features/sidebar/usePinnedTasks.ts`, `ChannelPinnedMenu.tsx` / `dashboard.pinnedAt`, `useChannelStars.ts` |
| Task view with tabs | Built — `PanelLayout` is a tabbed/splittable tree; default = Chat + Terminal tabs, N terminals supported | `features/panels/`, `packages/core/src/panels/panelLayoutTransforms.ts` (`addTerminalTab`), `TabContentRenderer.tsx` |
| PR tab showing diff | Built as the `review` tab type / resizable review pane (incl. inline PR comment threads) | `features/code-review/ReviewPage.tsx`, `CloudReviewPage.tsx`, `reviewNavigationStore.ts` |
| Multiple chats per task | **Does not exist** — hard 1:1 task↔session (`sessionStore` keys one run per task; new session replaces) | `packages/core/src/sessions/sessionStore.ts` |
| Canvas tab inside a task | **Does not exist live** — only a read-only instructions snapshot; canvases are channel-routed, linked by `generationTaskId` | `CanvasInstructionsTab.tsx`, `packages/core/src/canvas/dashboardSchemas.ts` |
| Right panel on a task | Built — `ThreadSidebar` docks `ThreadPanel` next to `TaskDetail`, but only on the channel task route | `router/routes/website/$channelId/tasks/$taskId.tsx`, `ThreadSidebar.tsx`, `ThreadPanel.tsx` |
| Timeline ("thread renamed") | Built — durable task thread: human comments + `pr_created`/`canvas_created` artifact rows + composer | `packages/core/src/canvas/threadTimeline.ts`, `hooks/useTaskThread.ts`, `TaskThreadMessage` in `@posthog/shared/domain-types` |
| Artifact comment counts | Partially — real for PRs via GitHub; nothing for canvases (acknowledged in the mockup) | `features/pr-review/usePrComments.ts`, `usePrReviewThreads.ts` |
| Slack thread as external-link artifact | Data exists — one-way link on the run | `latest_run.state.slack_thread_url` (read in `packages/core/src/sidebar/buildSidebarData.ts`) |
| Task-level Comments tab | **No discrete concept** — human `TaskThreadMessage` rows are the closest substrate; no replies/anchoring model | `TaskThreadMessage`, `ThreadPanel.tsx` |
| Top-bar search field | ⌘K command palette only (modal); sidebar "Search" row opens it | `features/command/CommandMenu.tsx` |
| Top-bar Activity bell | Built as a **sidebar** row + full route (mentions feed, channels-only) | `ActivityItem`, `/website/activity`, `ActivityView.tsx` |
| Top-bar Inbox icon | Built as a **sidebar** row + full route; no `/website` mirror yet ("jumps back to Code") | `InboxItem`, `/code/inbox`, `InboxView` |
| Arc-style space dots / swipe | **Does not exist** | — |

## Prototype principles

1. **One switch to flip.** Everything lands behind a `spacesLayout` view-state toggle in `sidebarStore` (persisted, dev-default off), surfaced next to the existing "Channels" alpha switch. Flipping it swaps the chrome inside the Channels space only. Anyone on the team can try it and flip back; the Code space and the current Channels layout keep working unchanged.
2. **No new backend or domain models.** Every panel is fed by data that already exists (task thread messages, run output/state, dashboards, GitHub PR data). Where the mockup wants data we don't have (canvas comments, comment replies, multi-session), the UI shows what exists and omits or disables the rest — exactly as the mockup allows ("for now we can do what is available").
3. **Renames are cheap, do them properly.** "Thread" → "Timeline" and "CONTEXT.md" → "Context" are label changes in the new chrome only; no store/schema renames during the prototype.
4. **Navigation reuses existing routes.** Sidebar entries and top-bar icons navigate to routes that already exist (`/website/$channelId/*`, `/website/activity`); the only new route is an inbox mirror.

## Design decisions

### Shell & top bar
- When `spacesLayout` is on (and inside `/website`), the title bar center swaps the browser-tab strip for a **search field** that opens the existing ⌘K `CommandMenu` on click/focus (no new search engine; the palette already finds tasks, channels, files, actions).
- Right side of the title bar gains two icon buttons: **Activity** (bell, unread-mention dot from `useUnreadChannels`/`activitySeenStore`) → navigates to `/website/activity`; **Inbox** → navigates to a new `/website/inbox` mirror route rendering the existing `InboxView` (same pattern as the existing `/website/activity|command-center|skills|mcp-servers` mirrors), so opening it doesn't eject you from the space.
- Open question tracked below: the mockup has no global tab strip (tabs move *inside* the task). The prototype hides `BrowserTabStrip` in spaces mode to match; if that feels bad we re-show it.

### Sidebar in space mode
New `SpaceSidebar` body inside `ChannelsSidebar` (rendered when `spacesLayout` && a channel is active; the current all-channels list remains the landing/no-space state):
- `+ New task` → `/website/$channelId/new` (files the task into the space's channel — route exists).
- `# channel` header row → channel home (`/website/$channelId`).
- **Context / Loops / Artifacts** rows → the three existing section routes. "Recents" drops out of the tab row: it *becomes* the sidebar list below.
- **Pinned**: pinned canvases of this channel (`dashboard.pinnedAt`, exists) + pinned tasks filed to this channel (`usePinnedTasks` ∩ `useChannelTasks`). First place the two pinning systems render together.
- **Recents**: the same union `WebsiteChannelHistory` already computes (filed tasks + canvases, most-recent-first), rendered as sidebar rows.
- Footer: **space dots** (see below), then the existing settings gear + `ProjectSwitcher` (the mockup's "Account" button).

### Space dots (the Arc bit)
- One dot per **starred channel**, plus the current channel if it isn't starred. Starred channels are the curated "spaces" set — the concept and persistence already exist (`useChannelStars`); the dots are just a new, compact renderer for it.
- Click a dot → navigate to that channel (its space). Hover → tooltip with `# name`. Active dot filled. `+` → the existing choose/create channel flow (`CreateChannelModal`).
- Keyboard: `ctrl+alt+←/→` cycles spaces. Trackpad swipe (wheel `deltaX` on the sidebar/canvas) is a stretch goal — noted, not required for the prototype.

### Task view (center)
- The route stays `/website/$channelId/tasks/$taskId`; `TaskDetail`'s existing `PanelLayout` **is** the mockup's tab row (Chat + Terminal are already tabs; the breadcrumb `#channel / task` already renders in the header).
- The panel `+` becomes a small dropdown: **New terminal** (works today, `addTerminalTab`), **New chat** and **New canvas** shown disabled with a "soon" hint — per the mockup's own note that only what's available needs to work.
- **Artifact → tab**: clicking an artifact in the right panel opens it inside the task:
  - PR → the existing `review` tab type (diff view — matches "on click, show diff").
  - Canvas → new `TabData` variant `canvas` mounting the existing canvas renderer (`WebsiteDashboard`'s inner component) read-only inside a panel tab; if the iframe-in-panel plumbing fights back, prototype fallback is navigating to the canvas route.
  - Slack thread → external link (OS browser), as in the mockup.

### Right "Activity" panel
Replace the docked `ThreadPanel` (in spaces mode) with an `ActivityPanel` in the same `ThreadSidebar` shell (resizable/collapsible for free), with a header and three tabs:
- **Timeline** — the existing `ThreadPanel` content unchanged (human messages, `pr_created`/`canvas_created` artifact cards, agent status, composer). The mockup says this is the current thread under a new name, so we treat it exactly that way.
- **Artifacts** — new task-scoped list derived with no new backend: PRs from `latest_run.output.pr_url` + `pr_created` thread events (state + comment count via `usePrInfo`/`usePrComments`/`usePrReviewThreads`), canvases from `canvas_created` thread events / `generationTaskId`, and the Slack thread from `latest_run.state.slack_thread_url` rendered as an external link. Canvas/Slack rows render without counts (no data yet — acknowledged in the mockup).
- **Comments** — the human-authored subset of the same task thread (`TaskThreadMessage` where `author_kind: "human"` and no `event`), plus the existing composer as `+ Add new`. Flat list for the prototype: no replies, no artifact anchoring (needs a data model — deferred). If a message payload carries a source, show it as a badge.

## Build plan

**Phase 1 — Shell (the part you can *feel* first).**
Toggle in `sidebarStore` + settings row; `SpaceSidebar` (nav entries, pinned, recents); space dots + keyboard cycling; top bar swap (search field, bell, inbox icons); `/website/inbox` mirror route.
Touches: `features/sidebar/sidebarStore.ts`, `features/canvas/components/ChannelsSidebar.tsx` (+ new `SpaceSidebar.tsx`, `SpaceDots.tsx`), `router/routes/__root.tsx` (title bar), new `router/routes/website/inbox.tsx`.

**Phase 2 — Activity panel.**
`ActivityPanel.tsx` with the three tabs inside `ThreadSidebar`; `TaskArtifactsTab.tsx` (derived artifact list + PR comment counts); `TaskCommentsTab.tsx` (filtered thread + composer); Timeline = existing `ThreadPanel`.
Touches: `features/canvas/components/` (new files), reuses `threadTimeline.ts`, `useTaskThread.ts`, `features/pr-review/usePr*`.

**Phase 3 — Task tabs.**
`+` dropdown on the panel tab strip (terminal live; chat/canvas disabled); `canvas` tab type in `panelTypes.ts`/`TabContentRenderer.tsx`; wire artifact clicks → open review tab / canvas tab / external link.
Touches: `packages/core/src/panels/panelTypes.ts` + `panelLayoutTransforms.ts`, `features/panels/components/TabbedPanel.tsx`, `TabContentRenderer.tsx`, `features/task-detail/`.

**Phase 4 — Polish & demo.**
Empty states (quill `<Empty>`), unread dots on space dots, transition animation between spaces (simple slide; Arc-grade springs later), a short demo script in this doc, then a team walkthrough build.

Phases 1 and 2 are independent and can land in either order; 3 depends on 2 (artifact clicks) only for wiring.

## Explicitly deferred (needs real data-model work)

- **Multiple chat sessions per task** — requires breaking the 1:1 `taskId ↔ taskRunId` model in `sessionStore`/backend. The `+` menu ships with "New chat" disabled.
- **Comment replies & artifact-anchored comment threads** — needs a comments model (parent id, anchor ref) beyond `TaskThreadMessage`.
- **Canvas comments** — acknowledged in the mockup as not existing yet.
- **Slack thread sync** — only the one-way originating link exists; rendering it as an external-link artifact is the prototype scope.
- **Unified pinning model** — the prototype *renders* pinned tasks + canvases together but keeps the three existing persistence mechanisms.
- **Trackpad swipe + spring physics** for space switching; multi-window interactions with spaces.
- **Reconciling with the browser-tabs PRD** (`docs/plans/browser-tabs.md`) — spaces mode hides the global strip for now; if the team wants both, the tab strip could scope to the active space.

## Open questions

1. **Landing state** — is the all-channels sidebar the "no space selected" home (assumed here), with clicking a channel entering its space?
2. **Which channels are spaces?** Assumed: starred channels form the dot row (curated, Arc-like), everything else reachable via search/landing. Or should every channel get a dot?
3. **Global tab strip** — the mockup drops it in favor of tabs inside the task. Hide it in spaces mode (assumed), or keep both levels of tabs?
4. **Inbox/Activity identity** — top-bar Inbox = the existing Self-driving inbox (reports/PRs/runs), Activity = the mentions feed, just relocated? Or is a different notion of "inbox" intended?
5. **"Context"** = today's per-channel CONTEXT.md renamed, correct?
6. **Pinned scope** — pinned tasks are global today; the space sidebar shows only those filed to the current channel. OK?
7. **Comments v1** — flat comments on the existing task-thread substrate (no replies/anchors) acceptable for the prototype?
8. **Disabled `+` items** — show "New chat"/"New canvas" disabled with a "soon" hint (assumed, communicates the vision), or hide them entirely?

## How to try it

1. Enable the **Channels** alpha switch in the sidebar (Bluebird flag is default-on in dev).
2. Enable **Spaces layout** next to it.
3. Star two or three channels → they appear as dots. Enter one, run a task, open the Activity panel tabs, click a PR artifact to get the diff tab.
