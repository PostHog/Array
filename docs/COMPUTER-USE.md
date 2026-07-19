<!-- markdownlint-disable MD013 -->

# Computer use

PostHog Code can give local agent sessions tools to see and control the macOS desktop across supported agent adapters.

## Enable it

1. Open **Settings → Advanced**.
2. Enable **Computer use**.
3. Start a new local session.
4. Grant Screen Recording and Accessibility access when macOS requests it.

The setting applies when a session starts. Existing sessions are unchanged.

## Behavior

- Computer use is opt-in and disabled by default.
- It is available only to local sessions on macOS.
- Agents can capture the desktop, list visible applications, open or focus applications, click coordinates, type text, and press keys.
- Claude, Codex, and future adapters receive the same PostHog-owned MCP tools rather than adapter-specific computer-control implementations.
- Cloud sessions and unsupported operating systems do not receive the tools.
- Tool calls use the existing MCP tool-call and approval pipeline.

## Safety

- Review the screen before approving an action and verify the result after it runs.
- Do not ask an agent to enter passwords, tokens, recovery codes, or other secrets.
- Disable the setting and start a new session to remove the tools.
- Revoke access in **System Settings → Privacy & Security → Screen Recording** or **Accessibility** to prevent native control.

## Scope

The initial implementation uses macOS system utilities for screenshots, application launching, mouse input, and keyboard input. It does not provide computer control to cloud tasks because those tasks do not run on the user's computer. Remote computer use would require an explicit device connection, user-presence controls, and a separate security design.

## Implementation

Computer actions are registered in the shared local-tools MCP registry. The Claude adapter exposes that registry through its in-process MCP server, while the Codex adapter exposes the same registry through its stdio MCP server. Session metadata gates the tools by environment, operating system, and the user's opt-in setting.
