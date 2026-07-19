<!-- markdownlint-disable MD013 -->

# Computer use

PostHog Code can give local agent sessions tools to control the Mac and cloud tasks tools to control an isolated Linux desktop in their sandbox.

## Enable it

1. Open **Settings → Advanced**.
2. Enable **Computer use**.
3. Start a new local session or cloud task.
4. For local sessions, grant Screen Recording and Accessibility access when macOS requests it.

The setting applies when a session or cloud task starts. Existing runs are unchanged.

## Behavior

- Computer use is opt-in and disabled by default.
- Local sessions control the user's Mac. Cloud tasks control a virtual Linux desktop inside their own sandbox.
- Agents can capture the desktop, list visible applications, open or focus applications, click coordinates, type text, and press keys.
- Claude, Codex, and future adapters receive the same PostHog-owned MCP tools rather than adapter-specific computer-control implementations.
- Unsupported operating systems do not receive the tools.
- Tool calls use the existing MCP tool-call and approval pipeline.

## Safety

- Review the screen before approving an action and verify the result after it runs.
- Do not ask an agent to enter passwords, tokens, recovery codes, or other secrets.
- Disable the setting before starting a new session or cloud task to omit the tools.
- Revoke access in **System Settings → Privacy & Security → Screen Recording** or **Accessibility** to prevent native control.

## Scope

Local sessions use macOS system utilities for screenshots, application launching, mouse input, and keyboard input. Cloud tasks start a virtual X display and lightweight window manager in the sandbox, then use Linux desktop utilities for the same actions. The cloud desktop contains only the task sandbox and cannot access the user's computer.

## Implementation

Computer actions are registered in the shared local-tools MCP registry. The Claude adapter exposes that registry through its in-process MCP server, while the Codex adapter exposes the same registry through the packaged stdio MCP server. Session metadata gates the tools by environment, operating system, and the user's opt-in setting.
