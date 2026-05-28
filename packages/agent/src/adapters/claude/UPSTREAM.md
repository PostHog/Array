# Upstream Sync

Fork of `@anthropic-ai/claude-agent-acp`. Upstream repo: https://github.com/anthropics/claude-code

## Fork Point

- **Forked**: v0.10.9, commit `5411e0f4`, Dec 2 2025
- **Last sync**: v0.38.0 + #716, commit `61ebda2`, May 28 2026
- **SDK**: `@anthropic-ai/claude-agent-sdk` 0.3.154, `@agentclientprotocol/sdk` 0.22.1, `@anthropic-ai/sdk` 0.100.0

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

## Changes Ported in v0.38.0 Sync

- **SDK bumps**: claude-agent-sdk 0.3.144 -> 0.3.154, anthropic SDK 0.96.0 -> 0.100.0 (ACP SDK
  unchanged at 0.22.1).
- **Compaction state-flag fix** (#716, a172885): SDK 0.3.154 emits the terminal `status` carrying
  `compact_result` twice for failed compactions. Added a per-turn `compactionInProgress` flag in
  `prompt()` so the user sees a single `Compacting completed.` / `Compacting failed: <reason>`
  chunk. Manual `/compact` outcomes now surface here rather than via `compact_boundary` (which only
  fires when there's content to compact).
- **System-role guard on user/assistant handler** (#716, a172885): Added an early return in
  `handleUserAssistantMessage` for `message.message.role === "system"`, covering both upstream's
  `<local-command-stdout>` strip branch guard and the broader assistant-handler guard. Avoids
  rendering SDK-injected system reminders as user-visible chunks.
- **New no-op content block types** (#716, a172885): Added `advisor_tool_result` and
  `mid_conv_system` cases to `processContentChunk` so unknown content blocks don't trip the
  `unreachable` default.
- **Opus 4.8 model entries** (#718, 98b54a0): Added `claude-opus-4-8` to gateway model maps with
  1M context, effort and xhigh-effort support. MCP injection auto-included (Haiku exclusion only).

## Skipped in v0.38.0 Sync

- **Remove hide Claude auth flag** (#707, 7ed1daf): Our fork already returns `authMethods: []`
  unconditionally; no flag to remove.
- **`thinking_tokens` status case** (#716, a172885): Our `handleSystemMessage` switch on
  `status === "compacting"` is non-exhaustive (no default `unreachable`), so unknown status values
  already no-op harmlessly.
- **Empty CI-retry commit** (#718, 98b54a0): No code change in the commit itself; the model entries
  it carried are ported above.
- **`MessageDisplay` hook + `SessionStart` reloadSkills/sessionTitle** (SDK 0.3.152): Available in
  the bumped SDK but not wired into our fork; upstream doesn't consume them in #716 either. Defer
  to a focused PR if we want the capability.

## Changes Ported in v0.37.0 Sync

- **SDK bumps**: claude-agent-sdk 0.2.114 -> 0.3.144, ACP SDK 0.19.0 -> 0.22.1, anthropic SDK 0.89.0 -> 0.96.0
- **TodoWrite -> Task tools migration** (SDK 0.3.142): Replaced TodoWrite snapshot tool with incremental
  TaskCreate/TaskUpdate/TaskGet/TaskList. Added `conversion/task-state.ts` and `createTaskHook` to mirror the
  SDK `TaskCreated`/`TaskCompleted` hook events into a per-session task map; plan entries are derived from
  Map insertion order (preserves upstream ordering semantics).
- **MCP_CONNECTION_NONBLOCKING=0** (SDK 0.3.142): SDK changed MCP servers to background-connect by default;
  set env to restore blocking-connect behavior so MCP tools are available on first prompt.
- **ACP SDK 0.22 breaking changes**: Renamed `unstable_resumeSession` -> `resumeSession`; new
  `McpSdkServerConfig` variant (`type: "sdk"`) in the `McpServerConfig` union. Our
  `parseMcpServers` only accepts `http`/`sse`/stdio entries, so `sdk` falls through and is
  implicitly dropped (no explicit filter needed).
- **Skills option** (SDK 0.2.133): `'Skill'` in `allowedTools` deprecated; replaced with `skills` option.
- **Memory recall tool calls** (#703, a0bfb98): Emit a `tool_call` for SDK `memory_recall` events so the
  UI shows what memories were surfaced; addresses phantom MEMORY.md read attempts.
- **Write diff fix** (#618, 8d7e220): `toolUpdateFromEditToolResponse` now also processes `Write` tool
  responses so overwrites show real diffs instead of optimistic "creation" diffs.
- **Local-command-stdout render** (#649, 3b9b7d5): Strip marker tags from `<local-command-stdout>` content
  and render remaining prose so custom slash commands and skill expansions reach the UI.
- **Cancelled vs end_turn** (#694, 2414a6f): `session_state_changed: idle` handler now reports
  `stopReason: "cancelled"` when the session was interrupted.
- **Recover prompt stream** (#706, 2711f50): After a failed turn, drain the trailing
  `session_state_changed: idle` so the next prompt's first `query.next()` doesn't short-circuit.
- **additionalDirectories field** (#684, f37e9a0): Accept the official ACP field on session lifecycle
  requests; advertise via `sessionCapabilities.additionalDirectories`. Legacy `_meta.additionalRoots` still
  honored as fallback.
- **availableModels allowlist** (#637, 867a3a0): `ClaudeCodeSettings.availableModels` array merged-and-deduped
  across settings sources, then applied to gateway model options via `applyAvailableModelsAllowlist`.
- **Model alias version match** (#702, e1e1c69): Refuse cross-version alias matches in `resolveModelPreference`
  so `claude-opus-4-6` doesn't get copied onto the `opus` alias when it resolves to 4.7.
- **Hide /clear** (#705, cfce130): `/clear` removed from advertised commands; clients should use
  `session/new` for the same effect.
- **No-op ping events** (#698, 694221a): `streamEventToAcpNotifications` no-ops `ping` keep-alive events
  instead of falling through to `unreachable` and spamming stderr.

## Skipped in v0.37.0 Sync

- **Avoid redundant initial model sync** (#704, b275f6f): Our flow already guards `setModel` behind
  `!isResume && resolvedSdkModel !== DEFAULT_MODEL`, so the upstream optimization is redundant.
- **Default effort option** (#701, 9e259d1): Our effort options are model-class-based rather than
  SDK-supplied; the implicit no-override path already covers the "let SDK decide" case.
- **Gate auto mode on model support** (#604, ec47d34): Our `auto` mode is gated behind `ALLOW_BYPASS`,
  not per-model `supportsAutoMode`. Per-model gating would be a larger refactor.

## Skipped in v0.30.0 Sync

- **Separate auth methods** (v0.25.0): PostHog returns empty authMethods
- **Session fingerprinting** (v0.25.3): PostHog uses explicit `refreshSession()` instead
- **Process exit on ACP close** (v0.27.0): PostHog embeds agent in server

## Next Sync

1. Check upstream changelog since v0.37.0
2. Diff upstream source against PostHog Code using the file mapping above
3. Port in phases: bug fixes first, then features
4. After each phase: `pnpm --filter agent typecheck && pnpm --filter agent build && pnpm lint`
5. After all phases: `pnpm typecheck && pnpm test`
6. Update this file
