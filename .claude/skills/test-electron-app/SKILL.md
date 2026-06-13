---
name: test-electron-app
description: Drive the real running PostHog Code Electron app (live tRPC, workspace-server, real data) over CDP with agent-browser. Connect to the running app on port 9222, snapshot the accessibility tree, click/type/navigate, and screenshot to verify a change in the actual desktop app. Use when asked to test, verify, dogfood, screenshot, or interact with the running app. For regression specs use the Playwright E2E suite.
allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*), Bash(pnpm app:cdp*)
---

# Test the real PostHog Code Electron app

Drive the actual running app over the Chrome DevTools Protocol with
[agent-browser](https://github.com/vercel-labs/agent-browser). The dev app
already launches with `--remote-debugging-port=9222` (see `apps/code/package.json`),
so an agent can connect, snapshot the UI, interact, and screenshot the live app.

This exercises **real** state: live tRPC, workspace-server, GitHub/Slack, and
whatever profile is signed into `~/.posthog-code`. Pick the right surface:

| Goal | Tool |
| --- | --- |
| Verify or screenshot a change in the **real** app, live data | this skill (agent-browser + CDP :9222) |
| **Regression** coverage in CI | Playwright E2E (`apps/code/tests/e2e/`) |

## Prerequisites

```bash
npm i -g agent-browser && agent-browser install   # once
```

The app must be running with remote debugging. `pnpm dev` (or `pnpm dev:code`)
already passes `--remote-debugging-port=9222`. Preflight + connect:

```bash
pnpm app:cdp        # checks agent-browser + that the app is up on :9222, then connects
```

If it reports the app is not reachable, start it with `pnpm dev` and retry.

## Load the canonical commands

agent-browser serves version-matched docs. Read them before driving:

```bash
agent-browser skills get electron     # Electron-over-CDP workflow (authoritative)
agent-browser skills get core         # snapshot/interact/screenshot reference
```

## The loop

```bash
agent-browser connect 9222                      # attach to the running app
agent-browser --color-scheme dark snapshot -i   # interactive elements only (app is dark by default)
agent-browser click @e5                          # act on a ref from the snapshot
agent-browser snapshot -i                        # ALWAYS re-snapshot after the UI changes
agent-browser screenshot /tmp/app-state.png      # capture; read the PNG back to verify
agent-browser close                              # done — free the session
```

Refs (`@e1`, `@e2`, …) are reassigned on every snapshot and go stale the moment
the UI changes. Re-snapshot before the next ref interaction.

The renderer uses `data-testid` heavily, so prefer stable locators over refs
when you know the target:

```bash
agent-browser find testid new-task-button click
agent-browser find role button click --name "New task"
agent-browser find text "Settings" click
```

## Screenshots

```bash
agent-browser --color-scheme dark screenshot out.png   # viewport (dark to match the app)
agent-browser screenshot --full out.png                # full page instead of viewport
```

Navigate to the target view first (click through the UI), then capture. agent-browser prints the saved path — read the PNG back to verify. Repeated captures reuse the connected session, so batches are fast.

## Repo specifics

- **Port:** `9222` (override with `POSTHOG_CODE_CDP_PORT`). Collides with Chrome's
  default debugging port — if `connect` attaches to the wrong target, list and
  pick the PostHog window: `agent-browser tab` then `agent-browser tab --url "*"`.
- **Multiple targets:** the app has a main renderer window (page title contains
  "PostHog Code") plus possible webviews/devtools. `agent-browser tab` lists them;
  switch with `agent-browser tab <index>`.
- **Dark mode:** CDP defaults to `light`; pass `--color-scheme dark` (or set
  `AGENT_BROWSER_COLOR_SCHEME=dark`) so screenshots match the real app.
- **Auth / data:** you drive whatever is signed into `~/.posthog-code`. If the app
  shows onboarding or sign-in, that is the real boot state. Do not mutate
  production data (don't create real tasks/PRs) while exploring.
- **Boot timing:** after launching the app, give it a few seconds before
  connecting; the renderer settles after `#root > *` appears and "Loading" clears.

## Running alongside prod

PostHog Code orchestrates the agent, so the usual loop is: **prod** (the installed app) runs the agent, and the **dev** build (`pnpm dev`) is the system under test. They coexist by design (`apps/code/src/main/bootstrap.ts`) — dev runs as `posthog-code-dev` with its own app name, userData, and single-instance lock, so it never collides with prod.

- **agent-browser always targets dev.** Only the dev build exposes CDP on `:9222`; prod has no debug port, so `connect 9222` can't accidentally drive prod.
- **Separate auth/state.** The dev instance has its own `posthog-code-dev` profile — it is not signed in just because prod is. Sign into the dev window once; its state persists.
- **One dev instance only.** Dev's single-instance lock, fixed dev callback port (`8238`), and `:9222` mean a second `pnpm dev` collides and quits. Run prod + one dev.
- **What reloads.** Renderer/UI changes hot-reload — just re-snapshot. Main-process/Electron changes need a dev restart to take effect.

## Troubleshooting

- **Connection refused on :9222** — the app isn't running with the debug flag.
  Start `pnpm dev`. Verify the port: `lsof -i :9222` or
  `curl -s localhost:9222/json/version`.
- **Snapshot is empty / wrong window** — you're on the wrong target. Run
  `agent-browser tab` and switch to the "PostHog Code" page.
- **Can't type into an input** — try `agent-browser keyboard type "text"` (types at
  current focus) or `agent-browser keyboard inserttext "text"` to bypass key events.
