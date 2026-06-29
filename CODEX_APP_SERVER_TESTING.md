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

- [ ] **Steering** (`turn/steer`): send a follow-up message *while a turn is running*.
  - Expect: injected into the live turn, not queued as a separate turn.
- [ ] **Interrupt / cancel mid-turn**: stop a running turn.
  - Expect: halts promptly **and** `_posthog/turn_complete` still fires (usage updates, UI returns to idle).
- [ ] **Structured output** (native `outputSchema`): run a task that has a JSON schema.
  - Expect: structured output emitted and the task run's `output` is populated.
- [ ] **Mode → approval-policy synthesis**: switch mode mid-session (Read-only ↔ Auto ↔ Full access).
  - Expect: subsequent tool calls respect the new policy (synthesized per-turn; no native mode RPC).
- [ ] **loadSession / resume**: close the task and reopen it (or reconnect).
  - Expect: prior history replays; you can continue prompting on the same thread.

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
- [ ] **Permission prompts**: exercise Allow once / Allow always / Reject.
  - Expect: "Allow always" sticks for the rest of the session.
- [ ] **MCP (PostHog tools)**: ask it to query PostHog via MCP.
  - Expect: read-only tools auto-approve (if configured), writes prompt; tools actually execute.
- [ ] **Skills / commands** (`available_commands_update`): confirm skill/slash commands appear and one runs.
- [ ] **AskUserQuestion / elicitation**: get the agent to ask a question.
  - Expect: UI renders the options and your answer flows back.
- [ ] **Image input**: paste/attach an image in a prompt.
  - Expect: image is sent and understood.
- [ ] **Additional directories** (worktree): confirm it can read/edit files outside the primary cwd.

## Tier 5 — Usage display & special modes

- [ ] **Token usage + context breakdown**: confirm the usage counter updates and the breakdown popover populates (systemPrompt / tools / skills / mcp / conversation). Driven by `_posthog/usage_update`.
- [ ] **Channel mode (repo-less task)**: start a task with no repo.
  - Expect: behaves as a general assistant; only attaches/clones a repo when actually needed.
