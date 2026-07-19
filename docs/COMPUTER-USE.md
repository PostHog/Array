<!-- markdownlint-disable MD013 -->

# Computer use

PostHog Code can give local agent sessions and cloud tasks tools to see and control the macOS desktop across supported agent adapters.

## Enable it

1. Open **Settings → Advanced**.
2. Enable **Computer use**.
3. Start a new local session or cloud task.
4. Grant Screen Recording and Accessibility access when macOS requests it.

The setting applies when a session or cloud task starts. Existing runs are unchanged.

## Behavior

- Computer use is opt-in and disabled by default.
- It is available to local sessions on macOS and cloud tasks created from the desktop app.
- Agents can capture the desktop, list visible applications, open or focus applications, click coordinates, type text, and press keys.
- Claude, Codex, and future adapters receive the same PostHog-owned MCP tools rather than adapter-specific computer-control implementations.
- Cloud tasks relay computer actions back to the desktop app, which must remain open and connected for the run to keep using them.
- Unsupported operating systems do not receive the tools.
- Tool calls use the existing MCP tool-call and approval pipeline.

## Safety

- Review the screen before approving an action and verify the result after it runs.
- Do not ask an agent to enter passwords, tokens, recovery codes, or other secrets.
- Cloud computer actions require approval on the connected desktop unless the action was allowed for the rest of that run.
- Disable the setting before starting a new session or cloud task to omit the tools. Closing the desktop app disconnects computer use from active cloud tasks.
- Revoke access in **System Settings → Privacy & Security → Screen Recording** or **Accessibility** to prevent native control.

## Scope

The implementation uses macOS system utilities for screenshots, application launching, mouse input, and keyboard input. Cloud workers do not access the computer directly: PostHog Code designates a built-in MCP server for the cloud run, relays each request through the existing task command channel, and executes approved actions on the connected desktop. Relay designations are held in memory, so restarting the app disconnects active runs rather than silently reconnecting them.

## Implementation

Computer actions are registered in the shared local-tools MCP registry. The Claude adapter exposes that registry through its in-process MCP server, while the Codex adapter and cloud relay expose the same registry through the packaged stdio MCP server. Local session metadata and cloud run relay designations gate the tools by operating system and the user's opt-in setting.
