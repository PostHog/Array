# Upstream Sync

Fork of `@anthropic-ai/claude-agent-acp`. Upstream repo: https://github.com/anthropics/claude-code

## Fork Point

- **Forked**: v0.10.9, commit `5411e0f4`, Dec 2 2025
- **Last sync**: v0.30.0, commit `e9dd452`, April 20 2026
- **SDK**: `@anthropic-ai/claude-agent-sdk` 0.2.112 (0.2.114 breaks session init, see agentclientprotocol/claude-agent-acp#575), `@agentclientprotocol/sdk` 0.19.0

## File Mapping

| PostHog Code | Upstream |
|---|---|
| `conversion/tool-use-to-acp.ts` | `tools.ts` |
| `conversion/sdk-to-acp.ts` | inline in `acp-agent.ts` |
| `conversion/acp-to-sdk.ts` | inline in `acp-agent.ts` |
| `claude-agent.ts` | `acp-agent.ts` |
| `permissions/*` | inline in `acp-agent.ts` |
| `session/options.ts` | inline in `acp-agent.ts` |
| `session/commands.ts` | inline in `acp-agent.ts` |
| `hooks.ts` | `tools.ts` |
| `types.ts` | inline |

## PostHog Code-Only Code (Do Not Sync)

- PostHog analytics (`_posthog/*` ext notifications, `_posthog/usage_update`)
- Process lifecycle (spawn wrappers, PID tracking, `onProcessSpawned`/`onProcessExited`)
- Plan mode (`plan/`, EnterPlanMode/ExitPlanMode handlers, plan validation)
- Gateway models (`session/models.ts`, `base-acp-agent.ts`, `fetchGatewayModels`)
- AskUserQuestion handler (`questions/`, `CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL`)
- Execution modes and tool allowlists (`tools.ts`, `CodeExecutionMode`)
- MCP metadata caching (`mcp/`)
- Branch naming in system prompt
- `broadcastUserMessage` in prompt()
- `interruptReason` on cancel
- `SYSTEM_REMINDER` stripping from Read tool results
- WebFetch `resourceLink` content enrichment
- `customTitle` in listSessions (PostHog Code is ahead of upstream here)
- SettingsManager `PreToolUse` hook for permission rules
- `ensureLocalSettings` / `clearStatsigCache`
- `ELECTRON_RUN_AS_NODE` / `ENABLE_TOOL_SEARCH` env vars

## Intentional Divergences

| Area | Upstream | PostHog Code | Reason |
|---|---|---|---|
| AskUserQuestion | Always disallowed | Enabled via env var + permission handler | PostHog Code supports structured questions |
| Model resolution | `initializationResult.models` from SDK | `fetchGatewayModels()` from gateway API | Different model backend |
| permissionMode | Hardcoded `"default"` | Reads from `meta.permissionMode` | More flexible mode selection |
| Session storage | `this.sessions[sessionId]` (multi) | `this.session` (single) | Architectural choice |
| bypassPermissions | `updatedPermissions` with `destination: "session"` | No `updatedPermissions` | Different permission persistence |
| Auth methods | `claude-ai-login` + `console-login` | Returns empty `authMethods` | Auth handled externally |
| Session fingerprinting | Implicit teardown on cwd/mcp change | Explicit `refreshSession()` | Caller-initiated is more predictable |
| Shutdown on ACP close | Process exits | No standalone process | Agent is embedded in server |
| Unsupported slash commands | Loops silently on early idle | Emits "Unsupported slash command" chunk, gated on `initializationResult().commands` so plugin/skill commands (e.g. `/skills-store`) whose echoes use a fresh uuid are not false-flagged | The SDK consumes some slash commands without producing output (e.g. `/plugin` in non-interactive mode); without this we hang. The known-commands gate avoids racing plugin/skill loads where idle can arrive before the transformed user-message echo. |

## Changes Ported in v0.30.0 Sync

- **SDK bumps**: claude-agent-sdk 0.2.112 -> 0.2.114, ACP SDK 0.16.1 -> 0.19.0, anthropic SDK -> 0.89.0
- **Null-safe usage tokens** (v0.29.2): Guard against null usage fields from SDK
- **SettingsManager race fix** (v0.25.0): `initPromise` prevents concurrent `initialize()`/`setCwd()` corruption
- **Malformed settings warning** (v0.25.0): Log warning for non-ENOENT settings file errors
- **Idle state end-of-turn** (v0.23.0): `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` + `session_state_changed` idle handler
- **Mid-stream usage updates** (v0.29.1): Fire `usage_update` from `message_start`/`message_delta` stream events
- **Raw SDK message relay** (v0.27.0): `emitRawSDKMessages` on `NewSessionMeta` for opt-in diagnostics
- **Effort level sync** (v0.25.x): `xhigh` level added, `applyFlagSettings` on effort change
- **Auto permission mode** (v0.25.0): Added to `CODE_EXECUTION_MODES`, available modes, ExitPlanMode options

## Skipped in v0.30.0 Sync

- **Separate auth methods** (v0.25.0): PostHog returns empty authMethods
- **Session fingerprinting** (v0.25.3): PostHog uses explicit `refreshSession()` instead
- **Process exit on ACP close** (v0.27.0): PostHog embeds agent in server

## Next Sync

1. Check upstream changelog since v0.30.0
2. Diff upstream source against PostHog Code using the file mapping above
3. Port in phases: bug fixes first, then features
4. After each phase: `pnpm --filter agent typecheck && pnpm --filter agent build && pnpm lint`
5. After all phases: `pnpm typecheck && pnpm test`
6. Update this file
