---
name: test-electron-app
description: Drive the real running PostHog Code Electron app (live tRPC, workspace-server, real data) over CDP with agent-browser. Connect to the running app on port 9222, snapshot the accessibility tree, click/type/navigate and screenshot to verify a change in the actual desktop app. Use when asked to test, verify, dogfood, screenshot or interact with the running app. For regression specs use the Playwright E2E suite.
allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*), Bash(pnpm app:cdp*)
---

# Test the real PostHog Code Electron app

Drive the actual running app over the Chrome DevTools Protocol with
[agent-browser](https://github.com/vercel-labs/agent-browser). The dev app
already launches with `--remote-debugging-port=9222` (see `apps/code/package.json`),
so an agent can connect, snapshot the UI, interact and screenshot the live app.

This exercises **real** state: live tRPC, workspace-server, GitHub/Slack and
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

If it reports the app is not reachable, the app isn't running. Start it, then
retry `pnpm app:cdp`.

### Launching the app yourself (background / no TTY)

Do **not** use `pnpm dev` from a non-interactive shell. It builds deps then hands
off to the `phrocs` TUI process-multiplexer, which aborts without a controlling
terminal (`bubbletea: could not open TTY: /dev/tty: device not configured`). An
agent in a background shell has no TTY, so `pnpm dev` cannot launch it headlessly.

Build the workspace deps (TTY-safe, the same step `pnpm dev` runs first), then
launch only the Electron app with its stdin held open:

```bash
pnpm build:deps                        # turbo build of @posthog/code deps
tail -f /dev/null | pnpm dev:code      # run in the background; leave it running
```

`pnpm dev:code` is `electron-forge start -- --remote-debugging-port=9222` — just
the app, no TUI and no watch rebuilders (fine for screenshotting/interacting).

**The `tail -f /dev/null |` is required, do not drop it.** `electron-forge start`
runs an interactive "type `rs` to restart" stdin reader. With no stdin it hits
EOF immediately, treats that as quit, tears down the Electron window, and exits
**0** before the CDP port ever opens — so the app looks like it launched
("✔ Launched Electron app") and then silently vanishes. Piping from
`tail -f /dev/null` gives it a stdin that never closes, so it stays up. A
pseudo-TTY via `script` does **not** help: `script` forwards the EOF (`^D`) and
the app still quits.

Then wait for the port and connect (poll, don't sleep blindly):

```bash
until curl -s localhost:9222/json/version >/dev/null; do sleep 1; done
agent-browser connect 9222
```

### Clean up what you started

Only tear the app down **if you launched it**. If `pnpm app:cdp` found it already
up on `:9222`, it is the user's own instance — leave it running, just
`agent-browser close` your session.

When you started it, shut it down once you're done:

```bash
agent-browser close                      # free the CDP session
pkill -f "remote-debugging-port=9222"    # kill only the dev app you launched
```

Matching on `remote-debugging-port=9222` targets only your dev instance — prod has
no debug port and uses a separate `posthog-code-dev` profile, so this never
touches the user's running app. Then stop the background launcher: killing the app
leaves `tail -f /dev/null` alive, so stop that task too (`TaskStop`, or kill the
`tail … | pnpm dev:code` pipeline). Verify teardown with
`curl -s localhost:9222/json/version` (should fail) and
`pgrep -fl posthog-code-dev` (should be empty).

## Load the canonical commands

agent-browser serves version-matched docs. Read them before driving:

```bash
agent-browser skills get electron     # Electron-over-CDP workflow (authoritative)
agent-browser skills get core         # snapshot/interact/screenshot reference
```

## The loop

```bash
agent-browser connect 9222                      # attach (skip if you ran pnpm app:cdp)
agent-browser snapshot -i                       # interactive elements only (the app is already dark)
agent-browser click @e5                          # act on a ref from the snapshot
agent-browser snapshot -i                        # ALWAYS re-snapshot after the UI changes
agent-browser screenshot /tmp/app-state.png      # capture the current view
agent-browser close                              # done; free the session
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
agent-browser screenshot /tmp/app.png                  # viewport (absolute path = clickable)
agent-browser screenshot --full /tmp/app.png           # full page instead of viewport
```

Navigate to the target view first (click through the UI), then capture. agent-browser prints the saved path. Repeated captures reuse the connected session, so batches are fast.

### Always let the user open the capture

When the user asked for a screenshot, they want to look at it, so close the loop every time:

1. Save to and report an **absolute** path (`/tmp/app.png`, never a bare `out.png`). Claude Code renders absolute paths as clickable links, so the path itself opens the PNG on click.
2. Offer to open it for them, and on a yes run `open /tmp/app.png` (macOS opens it in Preview). If the request was clearly "screenshot it so I can see it", just open it instead of asking.
3. The user can also open it themselves at any time with `!open /tmp/app.png`.

## Repo specifics

- **Port:** `9222` (override with `POSTHOG_CODE_CDP_PORT`). Collides with Chrome's
  default debugging port; if `connect` attaches to the wrong target, list and
  pick the PostHog window: `agent-browser tab` then `agent-browser tab --url "*"`.
- **Multiple targets:** the app has a main renderer window (page title contains
  "PostHog Code") plus possible webviews/devtools. `agent-browser tab` lists them;
  switch with `agent-browser tab <index>`.
- **Never pass `--color-scheme dark`:** that global flag makes agent-browser apply
  device emulation that forces a 1280x720 viewport and renders this Electron window
  blank, and it sticks in the daemon (only restarting the agent-browser daemon
  clears it, not `close`). The app is already dark, so plain `agent-browser
  snapshot` / `agent-browser screenshot` is what you want.
- **Auth / data:** you drive whatever is signed into `~/.posthog-code`. If the app
  shows onboarding or sign-in, that is the real boot state. Do not mutate
  production data (don't create real tasks/PRs) while exploring.
- **Boot timing:** after launching the app, give it a few seconds before
  connecting; the renderer settles after `#root > *` appears and "Loading" clears.

## Running alongside prod

PostHog Code orchestrates the agent, so the usual loop is: **prod** (the installed app) runs the agent, and the **dev** build (`pnpm dev`) is the system under test. They coexist by design (`apps/code/src/main/bootstrap.ts`): dev runs as `posthog-code-dev` with its own app name, userData and single-instance lock, so it never collides with prod.

- **agent-browser always targets dev.** Only the dev build exposes CDP on `:9222`; prod has no debug port, so `connect 9222` can't accidentally drive prod.
- **Separate auth/state.** The dev instance has its own `posthog-code-dev` profile; it is not signed in just because prod is. Sign into the dev window once; its state persists.
- **One dev instance only.** Dev's single-instance lock, fixed dev callback port (`8238`) and `:9222` mean a second `pnpm dev` collides and quits. Run prod + one dev.
- **What reloads.** Renderer/UI changes hot-reload; just re-snapshot. Main-process/Electron changes need a dev restart to take effect.

## Troubleshooting

- **Connection refused on :9222:** the app isn't running with the debug flag.
  Start it (see *Launching the app yourself* for the headless recipe). Verify the
  port: `lsof -i :9222` or `curl -s localhost:9222/json/version`.
- **App launches then immediately exits 0; CDP never opens:** you started it with
  no stdin (background / no TTY) and `electron-forge` quit on stdin EOF. Relaunch
  with `tail -f /dev/null | pnpm dev:code` so stdin never closes (see *Launching
  the app yourself*). Note `pnpm dev` cannot run headlessly at all — its `phrocs`
  TUI needs a TTY; use `pnpm dev:code`.
- **Snapshot is empty / wrong window:** you're on the wrong target. Run
  `agent-browser tab` and switch to the "PostHog Code" page.
- **Can't type into an input:** try `agent-browser keyboard type "text"` (types at
  current focus) or `agent-browser keyboard inserttext "text"` to bypass key events.
