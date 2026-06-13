---
name: screenshot-dev-app
description: Take a screenshot of the PostHog Code renderer via the Vite web preview (localhost:5173 with ?previewMode=true). Navigate with hash routes, capture with agent-browser (screenshot-dev-preview.ts), and verify the PNG. Use when the user asks to screenshot, capture, or visually verify the dev app UI with mocked data. For the real running app with live data use test-electron-app instead.
---

# Screenshot the PostHog Code dev app

Capture the **mocked** Vite preview with [agent-browser](https://github.com/vercel-labs/agent-browser) via the `screenshot:preview` wrapper. Preview data is mocked — this is for layout checks, not live GitHub/Slack. To drive the **real** running app with live data, use the `test-electron-app` skill.

**Needs:** agent-browser (`npm i -g agent-browser && agent-browser install`) and Vite on localhost:5173 (`pnpm dev:code` / `pnpm dev:mprocs`).

## Capture

```bash
# one shot
pnpm --filter code screenshot:preview -- --route /code/inbox/pulls -o out.png

# batch — repeated runs reuse one warm browser (first capture ~5s, later ones ~3s)
pnpm --filter code screenshot:preview -- --route /code/inbox/reports -o reports.png
pnpm --filter code screenshot:preview -- --route /code/inbox/runs -o runs.png

# free the warm browser when done
agent-browser --session screenshot-preview close
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

## Ad-hoc captures

The wrapper handles preview URL building and readiness waits. For one-off captures you can also drive agent-browser directly:

```bash
agent-browser open "http://localhost:5173/?previewMode=true#/code/inbox/pulls"
agent-browser wait "#root > *"
agent-browser screenshot out.png
```
