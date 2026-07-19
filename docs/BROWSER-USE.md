<!-- markdownlint-disable MD013 -->

# Browser automation

PostHog Code can give local agent sessions browser automation tools through an isolated Playwright MCP server.

## Enable it

1. Install Google Chrome.
2. Open **Settings → Advanced**.
3. Enable **Browser automation**.
4. Start a new local session.

The setting applies when a session starts. Existing sessions are unchanged.

## Behavior

- Browser automation is opt-in and disabled by default.
- It is available only to local sessions.
- Each session launches an isolated Chrome profile, so it does not inherit cookies or logins from the user's normal browser profile.
- Tool calls and screenshots use the existing MCP tool-call pipeline.
- Cloud sessions do not receive the local browser server.

## Scope

This feature automates websites in a dedicated Chrome window. It does not control arbitrary desktop applications or the user's existing browser windows.

## Implementation

The workspace session layer injects a pinned `@playwright/mcp` stdio server for every supported local agent adapter instead of maintaining a bespoke browser-control protocol. This keeps browser lifecycle, accessibility snapshots, input actions, and image responses on Playwright's supported MCP implementation while reusing PostHog Code's existing MCP tool-call and approval surfaces.
