---
name: screenshot-dev-app
description: Screenshot the running PostHog Code app with agent-browser over CDP (port 9222). Connect to the running app, optionally navigate to a view, capture a PNG, and verify it. Use when asked to screenshot, capture, or visually verify the dev app UI. Data is live (the real app), not mocked. For full interaction (click/type/navigate flows) use the test-electron-app skill.
allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*), Bash(pnpm app:cdp:*)
---

# Screenshot the PostHog Code dev app

Capture the **real running app** with [agent-browser](https://github.com/vercel-labs/agent-browser) over the Chrome DevTools Protocol. The dev app already launches with `--remote-debugging-port=9222`, so connect and screenshot the live UI. Data is live, not mocked — for full snapshot/click/type interaction use the `test-electron-app` skill.

**Needs:** agent-browser (`npm i -g agent-browser && agent-browser install`) and the app running (`pnpm dev`, which exposes CDP on `:9222`).

## Capture

```bash
pnpm app:cdp                                              # preflight + connect to the app on :9222
agent-browser --color-scheme dark screenshot out.png     # capture (app is dark by default)
agent-browser screenshot --full out.png                  # full page instead of viewport
```

Read the saved PNG path that agent-browser prints and verify the content.

## Capture a specific view

The app is the real renderer, so navigate to the view first (the routes carry live data; there is no mock mode):

```bash
agent-browser snapshot -i                 # find nav elements
agent-browser find text "Settings" click  # navigate via the UI
agent-browser snapshot -i                 # re-snapshot after the view changes
agent-browser --color-scheme dark screenshot settings.png
```

Repeated captures reuse the same connected session, so batches are fast. Free it with `agent-browser close` when done.

## Notes

- **Dark mode:** CDP defaults to `light`; pass `--color-scheme dark` (or set `AGENT_BROWSER_COLOR_SCHEME=dark`) so screenshots match the app.
- **Live data:** you capture whatever is signed into `~/.posthog-code`. Don't mutate production data while navigating.
- **Wrong window / empty shot:** list targets with `agent-browser tab` and switch to the "PostHog Code" page.
- **Not reachable on :9222:** start the app with `pnpm dev`, then retry `pnpm app:cdp`.
