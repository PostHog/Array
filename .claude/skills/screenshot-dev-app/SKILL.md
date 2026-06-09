---
name: screenshot-dev-app
description: Take a screenshot of the PostHog Code renderer via the Vite web preview (localhost:5173 with ?previewMode=true). Navigate with hash routes, capture with Playwright (screenshot-dev-preview.ts), and verify the PNG. Use when the user asks to screenshot, capture, or visually verify the dev app UI.
---

# Screenshot the PostHog Code dev app

Capture via Playwright only — not cursor-ide-browser, Electron, or `screencapture`.

**Needs:** Vite on localhost:5173 (`pnpm dev:code` / `pnpm dev:mprocs`). First Playwright use: `pnpm exec playwright install chromium`.

## Capture

```bash
# one shot
pnpm --filter code screenshot:preview -- --route /code/inbox/pulls -o out.png

# batch (start once — first capture ~5s, later ones ~3s via hash navigation)
pnpm --filter code screenshot:preview:serve   # background
pnpm --filter code screenshot:preview -- --route /code/inbox/reports -o reports.png
pnpm --filter code screenshot:preview -- --route /code/inbox/runs -o runs.png
```

Read the printed PNG path and verify content. Flags: `-o`, `--full-page`, `--wait-for <text>`, `--url` (full URL), `--help`.

Preview URLs are `http://localhost:5173/?previewMode=true#<route>`. `--route` builds that automatically; `?previewMode=true` loads mocks from `apps/code/index.html`.

## Routes

| View | `--route` |
| --- | --- |
| Home | `/code` |
| Responders | `/code/agents` |
| Inbox pulls / reports / runs | `/code/inbox/pulls`, `/code/inbox/reports`, `/code/inbox/runs` |
| Inbox detail | `/code/inbox/pulls/<id>`, `/code/inbox/reports/<id>`, `/code/inbox/runs/<id>` |
| Settings | `/settings/<category>` |
| Skills, MCP, archived, tasks | `/skills`, `/mcp-servers`, `/code/archived`, `/code/tasks/<id>` |

Inbox mock ids: `r-1` … `r-8`. Settings categories include `signals`, `github`, `slack`, `general`, …

## When fixtures aren't enough

Edit the `?previewMode=true` block in `apps/code/index.html` (`mockReports`, tRPC `mocks`, `fetch` interceptor). Re-run capture after save. Preview data is mocked — layout checks only, not live GitHub/Slack.
