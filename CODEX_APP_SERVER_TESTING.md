# Codex app-server — manual test checklist

Manual QA for the native **codex app-server** sub-adapter in PostHog Code.
Tick items as you verify them.

## Before you start

- [ ] **Confirm you're actually on app-server** (not codex-acp). With a codex session running:
  - `pgrep -fl "codex app-server"` → a PID means app-server. A `codex-acp` process means the old adapter.
  - Or grep the dev log for `Codex sub-adapter selected: app-server (native codex)`.
- [ ] App-server requires: the native `codex` binary present (`apps/code/resources/codex-acp/codex`; run `node apps/code/scripts/download-binaries.mjs` if missing) **and** the opt-in on — the `codex-app-server` flag enabled for your user, or `POSTHOG_CODEX_USE_APP_SERVER=1`. With neither, you get codex-acp by design.
- [ ] Build/run with the adapter changes in the working tree (the flag is inert without them).

Triage tip: if something looks wrong, run the same action on **codex-acp** (flag off) and **claude**. Breaks only on app-server → adapter bug. Breaks everywhere → upstream of the adapter.

---

## Tier 1 — Regression-critical (these were genuinely broken in app-server and fixed)

- [ ] **PostHog system prompt takes effect** (was rendering as `[object Object]`)
  - Do: ask it to make a git commit, and to create a branch. Also set a custom instruction in settings.
  - Expect: commit message uses PostHog trailers (`Generated-By: PostHog Code`, `Task-Id: …`), **not** Claude's default attribution; new branches prefixed `posthog-code/`; custom instruction honored.
- [ ] **Initial permission mode is honored** (was ignored — always started in default)
  - Do: start three separate sessions, one each in **Read only**, **Auto**, **Full access**, then ask each to edit a file / run a command.
  - Expect: Read-only asks before *any* change; Auto asks only for risky ops; Full access auto-approves. The **first** action already respects the mode.
- [ ] **Pending / PR context prepend** (was being dropped)
  - Do: with a session running, trigger a context change — focus/unfocus a worktree (CWD move / detached HEAD), or reconnect a task that had queued context.
  - Expect: the next turn acknowledges the new working-dir/branch context.

## Tier 2 — App-server-specific protocol paths (new code, most likely to break)

- [x] **Steering** (`turn/steer`) — ✅ live e2e (`folds a mid-turn prompt into the running turn via steering`) + capability now reaches the host (was hardcoded to claude).
- [x] **Interrupt / cancel mid-turn** — ✅ live e2e (`interrupts an in-flight turn` + follow-up asserts `end_turn`); the false-green that hid the broken cancel is fixed.
- [x] **Structured output** (native `outputSchema`) — ✅ live e2e (`structured-output.e2e`).
- [x] **Mode → approval-policy synthesis** — ✅ live e2e: read-only **actually blocks an edit**, plan **engages codex's plan collaboration + reverts** on switch back. Modes are real, not cosmetic.
- [~] **loadSession / resume** — basic resume + list/fork pass live; the audit still wants a test proving the **tool transcript replays** against a persisted thread (not just count).

## Tier 3 — Config controls (UI selectors → adapter)

- [ ] **Model selector**: switch model mid-session.
  - Expect: the next turn uses the new model.
- [ ] **Reasoning effort selector**: switch effort (low/medium/high…).
  - Expect: applies; reasoning/thinking text still streams.

## Tier 4 — Tool calls & integrations (rendering + approvals)

- [ ] **File edits**: read / write / edit a file.
  - Expect: diff / file-change rendering looks correct in the UI.
- [ ] **Command execution**: run a bash command.
  - Expect: command-approval prompt (per mode) + output renders.
- [x] **Permission prompts** — ✅ verified manually: Allow once / Allow always / Reject / reject-with-feedback
  all work; "Allow always" sticks for the rest of the session.
- [ ] **MCP (PostHog tools)**: ask it to query PostHog via MCP.
  - Expect: read-only tools auto-approve (if configured), writes prompt; tools actually execute.
- [ ] **Skills / commands** (`available_commands_update`): confirm skill/slash commands appear and one runs.
- [x] **AskUserQuestion / elicitation** — ✅ live e2e (plan-mode round-trip): codex's `request_user_input` fires only in plan collaboration, and the `_meta.questions` shape now renders (was an empty "Review your answers" card).
- [ ] **Image input**: paste/attach an image in a prompt.
  - Expect: image is sent and understood.
- [ ] **Additional directories** (worktree): confirm it can read/edit files outside the primary cwd.

## Tier 5 — Usage display & special modes

- [ ] **Token usage + context breakdown**: confirm the usage counter updates and the breakdown popover populates (systemPrompt / tools / skills / mcp / conversation). Driven by `_posthog/usage_update`.
- [ ] **Channel mode (repo-less task)**: start a task with no repo.
  - Expect: behaves as a general assistant; only attaches/clones a repo when actually needed.

## Known issues / follow-ups

- [x] **MCP `exec` permission prompt shows raw codex text — FIXED.** The approval prompt for the PostHog MCP `exec` tool rendered `Allow the posthog MCP server to run tool "exec"?` instead of the real tool + command. Diagnosed from the session ACP logs (`~/.posthog-code/sessions/*/logs.ndjson`).
  - **Real root cause (the earlier hypothesis was wrong):** the exec approval does **not** come through `item/commandExecution/requestApproval` (the `mcpToolCallsByItemId` path). It comes through **`mcpServer/elicitation/request`** — confirmed by the prompt's `toolCallId: "posthog:elicitation"` (built in `approvals.ts handleMcpElicitation`) and the Accept/Decline options. The logs show two back-to-back messages: a `tool_call` with the real data (`title:"posthog/exec"`, `rawInput:{command,context}`) and a **separate** `session/request_permission` carrying only codex's generic `params.message` — no `_meta.posthog`, no rawInput. The elicitation handler never correlated to the in-flight `mcpToolCall`.
  - **Fix:** `handleMcpElicitation` now takes a `resolveMcpToolCall(serverName)` from `HandleServerRequestOptions`; the agent tracks `lastMcpToolCall` (set in `captureMcpToolCall`) and resolves it by matching `serverName`. When matched, the prompt carries `rawInput` + `_meta.posthog` (`mcp__posthog__exec`), mirroring the command-approval enrichment, so the host renders the proper MCP permission card. Falls back to codex's generic text when nothing correlates.
  - **Tests:** `approvals.test.ts` (enriches vs falls-back) + `codex-app-server-agent.test.ts` (end-to-end: `item/started` mcpToolCall → `mcpServer/elicitation/request` → enriched prompt). 64/64 green.
  - **Touched:** `approvals.ts` (`handleMcpElicitation`, `HandleServerRequestOptions`), `codex-app-server-agent.ts` (`captureMcpToolCall`, `handleApproval`, `lastMcpToolCall`).
  - **To verify live:** ask codex (on app-server) to run a PostHog MCP query; the approval prompt should now show the real tool + command, not the generic "run tool exec?".

- [x] **Mode picker on app-server (flattened, Claude-style) — IMPLEMENTED.** App-server now emits a `category:"mode"` config option (`session-config.ts buildConfigOptions`) with four presets — **Plan / Read only / Auto / Full access** — so the existing `ModeSelector` shows a switcher for app-server only (codex-acp/claude unchanged). Each preset maps to a `(collaborationMode, approvalPolicy)` tuple applied per-turn on `turn/start`. The adapter now negotiates `experimentalApi: true` (required for the experimental `collaborationMode` field). Verified against the real binary: `collaborationMode/list` → `[Plan, Default]`, `thread/start` accepts `collaborationMode:{mode,settings:{model}}`.
  - **To verify live:** switch the picker to **Plan** → codex should propose a plan, make no edits, and `request_user_input` (AskUserQuestion) should fire; switching to Auto/Read-only/Full-access should behave per approval policy. Exit Plan = switch the picker to a coding preset (sets `collaborationMode=default` next turn).
  - **Watch:** `experimentalApi: true` is a session-wide flip; confirm normal (non-plan) turns are unaffected.

- [ ] **AskUserQuestion / `request_user_input`** — unblocked by the Plan preset above (codex only injects the tool in `plan` collaboration mode). Test it by selecting **Plan** and asking codex something under-specified; the structured card should render via `approvals.ts handleToolUserInput`. (Was "N/A for codex"; now reachable on app-server.)

---

## Parity audit + RED-GREEN session (against the live binary + gateway)

A 15-feature parity audit (vs the Claude adapter, codex-acp, and the real codex protocol schema) found **42 confirmed items** (full list stashed at `scratchpad/audit-confirmed.json`; workflow `wf_f53857b7-a94`). The headline lesson: several existing tests were **false-greens** (they passed even with the feature broken). The live e2e runs here (gateway up at `localhost:3308`, token via `e2e/run-e2e.sh`).

### Fixed this session (RED → GREEN, with regression tests)

- [x] **Cancel/interrupt — the real bug.** Two layered defects, both fixed:
  1. `turn/interrupt` was sent with only `{ threadId }`; the schema requires `{ threadId, turnId }` (native binary rejects `-32600`). The error was swallowed and a local `finalizeTurn("cancelled")` masked it → false-green. Fixed: send `turnId`; the stub now enforces the schema (`makeStubRpc` throws on a turnId-less interrupt).
  2. Once interrupt actually fired, codex's **late `turn/completed(interrupted)`** for the cancelled turn finalized the *follow-up* turn as cancelled. Fixed with a `cancelledTurnIds` guard (drop the stale completion by `turn.id`). **Verified live** — the interrupt e2e now sends a follow-up prompt and asserts `end_turn`.
- [x] **Steering** — `turn/steer` response `turnId` was discarded, so `this.turnId` went stale and a later steer/interrupt targeted the wrong turn. Fixed + unit test.
- [x] **Skills** — disabled skills (`enabled:false`) were advertised in `available_commands_update`. Fixed (`!== false` filter) + unit test.
- [x] **Reasoning (mapping)** — only the raw `item/reasoning/textDelta` was mapped; gpt-5-family streams the **default** `summaryTextDelta`, which was dropped → no thinking reached the host. Mapping + `summary:"detailed"` added + parameterized unit test. *Live trigger still unconfirmed* (see deferred).
- [x] **MCP ambient-disable** — `mcp_servers.<name>.enabled=false` was emitted without name validation; a dotted/spaced server name wedges the whole session. Fixed (mirrors codex-acp's `/^[A-Za-z0-9_-]+$/` guard).

### Remaining (prioritized — from `scratchpad/audit-confirmed.json`)

Code bugs (unit-testable):
- [ ] **structured-output (#25)** — final-message capture ignores codex `MessagePhase`; a trailing `commentary` agent message can clobber the `final_answer` used for structured output. Prefer `final_answer` text.
- [ ] **usage `totalTokens` (#29)** — recomputed total drops `reasoningOutputTokens`; the e2e assertion is a tautology against the producer formula. Carry codex's authoritative total incl. reasoning.

False-green e2e strengthenings (live):
- [ ] **loadSession (#6)** — doesn't prove the tool transcript replays against a real persisted thread.
- [ ] **steering echo (#8)** — asserts only echo count (fires before the fold).
- [ ] **fileChange diff (#9)** — golden turn never asserts diff content (`parseUnifiedDiff`).
- [ ] **instructions {append}→flatten (#2)** — the prod `[object Object]` fix has no real-binary coverage.
- [ ] **structured-output (#24)** — passes even if `outputSchema` is never sent.
- [ ] tool-kind classification (#27), MCP-injection/local-tools e2e (#16), image-input e2e (#13), plan-rendering e2e (#35), command/file approval round-trip via read-only mode (#12).

### Deferred design issues (not quick fixes)

- [ ] **Modes are neutralized by the sandbox — plan mode is currently cosmetic.** The audit DISPROVED the earlier "Mode picker IMPLEMENTED" claim: `collaborationMode` on `turn/start` is **silently dropped** (codex ignores unknown fields — a `totallyBogusField123` is accepted too; acceptance ≠ effect). It only lives in *server→client* `ThreadSettings`, not any client turn/thread param. And `approvalPolicy` is neutralized because spawn forces `sandbox_mode=danger-full-access` (codex auto-approves everything). So all four presets currently behave identically. Making plan/read-only actually restrict needs per-turn `sandboxPolicy` — but `sandboxPolicy:readOnly` risks re-engaging the OS sandbox that spawn deliberately disables (linux-sandbox panics on cloud). Needs design. **Action:** at minimum remove the dead `collaborationMode` field + `collaborationModeFor` and correct the misleading comments/tests.
- [ ] **Reasoning live trigger (#11)** — `summary:"detailed"` did not surface `agent_thought_chunk` on the gpt-5-mini golden turn. Confirm the right lever (the `summary` turn field vs `-c show_raw_agent_reasoning=true` spawn config). The mapping fix + unit test stand regardless; the live e2e assertion is intentionally omitted until the trigger is confirmed.

---

## Ship-readiness RED-GREEN session (host/UI integration + CI guard)

### The CI-coverage truth (important)
The live e2e suite (`packages/agent/e2e`, `vitest.e2e.config.ts`) **does not run in CI** — it
is opt-in (`pnpm test:e2e`) and needs a live gateway + real codex binary + a minted token. So
the **unit suite (`src/**/*.test.ts`, the default `vitest run`) is the only automated regression
guard**, and its power depends on **stub fidelity**. Every bug the e2e can find now also has a
unit regression test. Practical rule going forward: when the e2e catches something, add the
unit test too, or CI won't protect it.

### Fixed (RED → GREEN, each with a unit regression test that runs in CI)
- [x] **Modes are real, not cosmetic — PROVEN LIVE.** Removed the dead `collaborationMode`
  turn/start field (silently dropped) and wired a per-turn `sandboxPolicy: {type:readOnly}` for
  plan/read-only. The first live e2e exposed that this alone did NOTHING: the edit still went
  through, because `spawn.ts` forced `sandbox_mode="danger-full-access"` on *every* platform, which
  disables codex's OS sandbox at the process level so a per-turn `sandboxPolicy` can't re-engage it.
  Fix: gate the spawn sandbox on `process.platform` (which mirrors sandbox availability) — macOS gets
  `workspace-write` (Seatbelt present → per-turn read-only can tighten and block edits), cloud/linux
  keeps `danger-full-access` (its linux-sandbox launcher is absent and would panic). A new live e2e
  (`read-only mode actually blocks a file edit`) now passes — read-only blocks the write while auto
  still edits — and a `spawn.test.ts` case locks the platform gating. This was the headline
  "deferred design issue"; it is now closed for local/desktop (cloud stays permissive by necessity,
  documented). `session-config.test.ts`, `spawn.test.ts`, and the live codex e2e arm (13/13).
- [x] **Native steering reaches codex.** The host hardcoded `adapter === "claude"` in both the
  `sendPrompt` gate and `useSupportsNativeSteer`, so codex's `turn/steer` was dead. Now
  capability-driven: the adapter's advertised `agentCapabilities._meta.posthog.steering` ("native"
  vs codex-acp's "interrupt-resend") flows host→session via the start/reconnect response, and
  both gates use the shared `sessionSupportsNativeSteer` helper. Belt-and-suspenders: Claude
  falls back to native if the capability is unset, so the rollout can't regress it.
  `shared/sessions.test.ts`.
- [x] **AskUserQuestion renders.** Codex `requestUserInput` emitted a bare `_meta:{header}` that
  failed `QuestionMetaSchema`, leaving an empty "Review your answers" card. Now emits a valid
  single-question `questions` array. `approvals.test.ts`.
- [x] **Bypass-mode revert is adapter-safe.** `maybeRevertBypassMode` forced `"default"`, which is
  not a codex mode (left an undefined approval state). New pure `resolveBypassRevertMode` picks a
  valid mode from the session's own options. `shared/sessions.test.ts`.
- [x] **Command/file approvals render richly.** Codex approvals lacked `kind`/`content` so they
  fell back to `DefaultPermission`. Now set `kind:"execute"` + command text / `kind:"edit"` + diff
  (reusing `mapping.diffContent`/`changePaths`) → ExecutePermission / EditPermission.
- [x] **Reasoning-effort labels** humanized (`Low`/`Medium`/`High`) to match Claude/codex-acp.
- [x] **Usage indicator survives an unknown context window.** `extractAggregate` no longer drops
  the whole aggregate when `size` is absent; the indicator shows the token count without a
  misleading "/0 · 0%". `contextUsage.test.ts` + `ContextUsageIndicator.test.tsx`.
- [x] **Context indicator tracks the current turn, not the cumulative thread total.** `emitUsageExtNotification`
  emitted `used` from `tokenUsage.total.totalTokens` (cumulative — grows every turn), so a real ~189k
  context displayed as ~433k (43% of a 997k window) and crept toward 100% from accumulation alone. codex's
  `ThreadTokenUsage` is `{ total, last, modelContextWindow }` (confirmed from the binary); `last` is this
  turn's breakdown = the actual occupancy (matches codex's own context-left math). Now `used`/`contextUsed`/`usage`
  read `tu.last` (fall back to `total` for turn-one/old builds); the cumulative `total` still feeds the per-turn
  delta in `turn_complete`. Regression test seeded with the real session numbers (total 433289 vs last 189075 →
  indicator asserts 189075). `codex-app-server-agent.test.ts`.
- [x] **Unit false-greens killed + stub hardened.** The cancel test at `817-844` passed without
  ever sending `turn/interrupt`; it now emits `turn/started` and asserts the RPC fired, plus a new
  test locks the turnId-undefined skip path. `makeStubRpc` now enforces the real required-field
  contract for `turn/interrupt` ({threadId,turnId}) and `turn/steer` ({threadId,input,expectedTurnId}).

### Verified non-issues (traced to the consumer, intentionally NOT changed)
- `usage.reasoningTokens` / `usage.cachedWriteTokens` / `usage.totalTokens` rename concerns — the
  host (`contextUsage.ts`) reads only `used`/`size`/`cost`; the `usage` sub-object is unread.
- `cachedWriteTokens: 0` — codex's app-server `TokenUsage.total` has no cache-write field; 0 is
  authoritative, not a dropped value (comment added).
- usage `totalTokens` (#29) — the adapter forwards codex's authoritative `total.totalTokens`, not a
  recompute, so reasoning isn't dropped.

### Adversarial re-review of the above (2nd workflow pass)
A second review workflow re-checked the working-tree diff across four dimensions. Three —
**steer-plumbing, host/UI-fixes, test-quality** — came back 10/10 (the steer capability is complete
end-to-end with no path that silently degrades a codex session and no claude regression; the new
unit tests are genuine guards that fail if their fix is reverted). The **missed-gaps** pass surfaced
five; the dispositions:
- [x] **cancelledTurnIds could accumulate** across a long-lived process if an interrupted turn's late
  completion never arrived — now cleared in `closeSession`.
- [x] **Question option descriptions were dropped** by the requestUserInput fix — now carried
  (non-empty only), with a test assertion.
- **MCP capture "race" — not a bug.** Capture is registered on BOTH `item/started` and
  `item/completed`, so whichever arrives first populates the cache; the proposed "only started" patch
  would *narrow* the window. The only true gap (approval before either event) is inherent.
- Two observability nits (debug-log a skill missing `enabled`; warn when a session has no non-bypass
  mode to revert to) intentionally skipped — both are effectively-impossible states and the logs
  would be noise.

### Plan mode is now a REAL mode (collaboration, not just sandbox) — PROVEN LIVE
The earlier "collaborationMode is silently dropped" conclusion was **wrong** — it was confused by
codex tolerating unknown fields. The truth, found by probing the binary's method registry + schema:
- collaboration mode is a **per-turn `turn/start` field** (`collaborationMode`), NOT a thread setting
  (`thread/settings/update` accepts it but doesn't honor it).
- Its shape is `{ mode, settings: { model, reasoning_effort? } }` — the `settings.model` must be a
  string (NOT the verbatim `collaborationMode/list` output, whose `model` is null). Sending a Default
  struct breaks `turn/start` ("Internal error: missing field/expected string"), so only **Plan** is
  sent; Default is codex's implicit mode (omitted).
Now `plan` sends `collaborationMode:{mode:"plan", settings:{model}}` on every turn, which unlocks
codex's plan proposals + `request_user_input` (AskUserQuestion). The behavioral e2e
`plan mode engages codex's plan collaboration (request_user_input becomes available)` proves it: it
instructs codex to call request_user_input and asserts the question reaches the host — which **only
happens in plan collaboration mode** (in default codex replies "request_user_input is unavailable in
this mode"). RED before the fix, GREEN after. Plan also keeps the read-only sandbox, so it both
proposes and can't edit. (Creation now also offers Plan — `execution-mode.ts` + core `executionModes.ts`.)

### Still open
- [x] **Live e2e RAN against the real gateway + binary** — the codex arm is **13/13** (steering folds
  mid-turn, interrupt halts in-flight, structured output delivers, and the new behavioral
  `read-only mode actually blocks a file edit` passes). This is the strongest ship-readiness signal:
  the steer/interrupt/modes fixes are confirmed end-to-end, not just unit-mocked.
- [ ] **A few e2e assertions remain intentionally loose** for live-model variance (the working-turn
  asserts `contains FOO`, not an exact diff; loadSession asserts replay count, not order). These are
  defensible against a non-deterministic model; tighten only if a real regression motivates it. The
  CI guard remains the unit layer (e2e does not run in CI).
- [ ] **Reasoning live trigger (#11)** — unchanged from above.
- [ ] **structured-output `MessagePhase` (#25)** / **mcp partial-fields** — deferred: no evidence
  codex's `agentMessage` carries a phase discriminator, and the `server && tool` cache guard is
  correct (caching partial entries would render "undefined"). Revisit only with a real repro.
