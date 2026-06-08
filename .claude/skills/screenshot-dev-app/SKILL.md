---
name: screenshot-dev-app
description: Take a screenshot of the PostHog Code renderer via the Vite web preview (localhost:5173 with ?previewMode=true). Navigate with hash routes, capture with cursor-ide-browser, and verify the PNG. Use when the user asks to screenshot, capture, or visually verify the dev app UI.
---

# Screenshot the PostHog Code dev app (web preview)

Navigate in a browser → capture with `browser_take_screenshot` → read the PNG.

**Prerequisites:** `pnpm dev:mprocs` or `pnpm dev:code` running (Vite on **localhost:5173**). Use **cursor-ide-browser** — do not control Electron or use `screencapture`.

## Workflow

1. **Navigate** — open the preview URL for the target hash route (step 1 below).
2. **Wait** — `browser_snapshot` shows sidebar buttons and page content, not an empty `#root`.
3. **Capture** — `browser_take_screenshot` (step 2 below).
4. **Verify** — read the PNG.

## URL shape

The renderer uses **TanStack Router with hash history** (`apps/code/src/renderer/router.ts`):

```text
http://localhost:5173/?previewMode=true#<hash-route>
```

`?previewMode=true` is required. It activates the dev shim in `apps/code/index.html` that mocks tRPC/auth so the UI mounts in a regular browser. Without it, the app cannot bootstrap outside Electron.

### Route map

| View | Hash route |
| --- | --- |
| New task (home) | `#/code` |
| Scouts & Responders | `#/code/agents` |
| Inbox → pulls | `#/code/inbox/pulls` |
| Inbox → reports | `#/code/inbox/reports` |
| Inbox → runs | `#/code/inbox/runs` |
| Inbox PR detail | `#/code/inbox/pulls/<reportId>` |
| Inbox report detail | `#/code/inbox/reports/<reportId>` |
| Inbox run detail | `#/code/inbox/runs/<reportId>` |
| Task detail | `#/code/tasks/<taskId>` (needs a real task id) |
| Skills | `#/skills` |
| MCP servers | `#/mcp-servers` |
| Command Center | `#/command-center` |
| Archived | `#/code/archived` |
| Settings | `#/settings/<category>` |
| Folder settings | `#/folders/<folderId>` |

Settings categories: `general`, `plan-usage`, `workspaces`, `worktrees`, `environments`, `cloud-environments`, `personalization`, `terminal`, `claude-code`, `shortcuts`, `github`, `slack`, `signals`, `updates`, `advanced`.

Mock report ids for inbox detail screenshots: `r-1` … `r-8` (defined in `apps/code/index.html`). Example: `http://localhost:5173/?previewMode=true#/code/inbox/pulls/r-2`.

## 1. Navigate

With **cursor-ide-browser**:

1. `browser_tabs` with `action: "list"` — reuse an existing tab or note the `viewId`.
2. `browser_navigate` to the preview URL. **Omit `position`** so automation stays in the background and does not steal focus.
3. `browser_snapshot` — confirm the target view rendered (e.g. tab bar on Inbox, section headings on Scouts & Responders).

Examples:

```text
http://localhost:5173/?previewMode=true#/code/agents
http://localhost:5173/?previewMode=true#/code/inbox/pulls
http://localhost:5173/?previewMode=true#/code/inbox/pulls/r-2
http://localhost:5173/?previewMode=true#/settings/signals
```

To exercise sidebar highlight / nav UX, `browser_click` a sidebar button (e.g. `Scouts & Responders`, `Inbox`) after landing on `#/code`.

## 2. Capture

`browser_take_screenshot`:

- Use `fullPage: true` for long pages (Scouts & Responders, settings).
- Set `filename` when saving a deliverable (e.g. `scouts-responders-verify.png`).
- Pass `viewId` if multiple tabs are open.

Then read the PNG to verify the correct route and content.

## Extending mock data

If the fixtures don't cover the state you need (empty list, missing field, connected GitHub, etc.), **edit the preview shim** — don't fall back to Electron. All preview mocks live in **`apps/code/index.html`** inside the `?previewMode=true` block:

- **`mockReports` / `fakeReport()`** — inbox list and detail cards (`r-1` … `r-8`)
- **`mocks`** — tRPC responses keyed by procedure name (e.g. `auth.getState`, `inbox.getSignalReports`)
- **`window.fetch` interceptor** — PostHog Cloud HTTP endpoints (report lists, artefacts, processing state)

Reload the preview URL after editing; Vite hot-reloads `index.html` on save.

## Gotchas

- **Preview mode = mock data.** GitHub/Slack show "Connect …" stubs unless you add mocks for them. Inbox uses fixture reports. Layout and component checks only — not live integrations.
- **Navigate before capture.** A screenshot of the wrong hash is a false pass.
- **`previewMode` must stay in the query string** when changing hash routes. If navigation drops it, re-add `?previewMode=true`.
- **Do not use Electron capture** (`screencapture`, Chrome DevTools Protocol on `:9222`) for this skill — the web preview is the supported path.
