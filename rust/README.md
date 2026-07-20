# Rust agent-server

Rust rewrite of the cloud `agent-server` from `@posthog/agent` (`packages/agent/src/server/`).
The TypeScript server wraps two full Node processes around every cloud run; this workspace replaces the outer one with a static binary while keeping every wire contract byte-compatible, so Django and clients cannot tell the implementations apart.

```text
before                                 phase 1                                   phase 2
──────                                 ───────                                   ───────
node agent-server (~150-400 MB RSS)    agent-server (Rust, ~10-25 MB RSS)        agent-server (Rust)
│  Hono HTTP /health /events /command  │  axum HTTP /health /events /command     │
│  4× NDJSON tap layers                │  parse-once bus → SSE/ingest/log sinks  │
│  event ingest, JWT, logs, session    │  event ingest, JWT, logs, session       ├─ claude-acp-driver (Rust)
└─ claude-agent-sdk (in-process)       └─ posthog-acp-claude sidecar (Node)      │  └─ claude CLI subprocess
   └─ claude CLI subprocess               └─ claude CLI subprocess               └─ codex-acp-driver (Rust)
                                                                                    └─ codex app-server (native)
```

Phase 2 replaces the Node sidecar with native drivers for both adapters — no PostHog Node process is left in the tree. `claude-acp-driver` speaks the Claude Code CLI's stream-json control protocol directly (the same wire protocol `@anthropic-ai/claude-agent-sdk` speaks); `codex-acp-driver` speaks the codex app-server's JSON-RPC protocol, porting the `codex-app-server-agent.ts` translation layer.

## Layout

- `crates/acp` — JSON-RPC 2.0 peer over ndjson streams (the client side of the [Agent Client Protocol](https://agentclientprotocol.com)), with a line tap so the host observes all traffic without re-parsing. Includes the `_posthog/*` extension method names (mirror of `packages/agent/src/acp-extensions.ts`).
- `crates/agent-server` — the server binary:
  - `http.rs` — `GET /health`, `GET /events` (SSE + 25s keepalives + buffered replay), `POST /command` (JSON-RPC), 404 shape
  - `jwt.rs` — RS256, audience `posthog:sandbox_connection`, TS-compatible error codes
  - `command.rs` — command schemas and aliases (mirror of `server/schemas.ts`)
  - `bus.rs` — envelopes are serialized once and shared (`Arc<str>`) across the SSE stream, the durable ingest sender, and replay buffering
  - `ingest.rs` — port of `TaskRunEventStreamSender`: seq numbers, seq-sync + 409 rebase, stream windows (900 events / 4 MB / 5 min), retries, `_posthog/stream_complete` sentinel
  - `server.rs` — session lifecycle (`initializeSession`, initial prompt turn, turn failure classification, completion signaling, cleanup)
  - `client.rs` — the agent's inbound surface: permission policy (auto-approve / question parking / Slack relay / client relay), mode tracking, PR attribution
  - `log_writer.rs` — `append_log` persistence with chunk coalescing and rawInput-snapshot deferral
  - `system_prompt.rs` — faithful port of the cloud system prompt builder
  - `adapter.rs` — spawns the ACP agent subprocess (`--adapterCmd` / `POSTHOG_ACP_ADAPTER_CMD`, default `./node_modules/.bin/posthog-acp-claude`)
  - `src/bin/mock_acp_agent.rs` — scripted ACP agent used by the e2e tests
- `crates/agent-tools` — tooling both drivers share: the full `@posthog/git/signed-commit` port (`signed_git.rs`, with every guard — mid-operation, behind-remote, base-leak), `gh` CLI execution with transient retry (`gh.rs`), commit-artefact reporting (`artefacts.rs`), and the `posthog-code-tools` MCP server answering `initialize`/`tools/list`/`tools/call` (`mcp.rs`)
- `crates/claude-driver` — the native Claude driver binary (`claude-acp-driver`), phase 2:
  - `transport.rs` — the CLI's stream-json control protocol (`control_request`/`control_response` correlation, concurrent handler dispatch)
  - `cli.rs` — CLI spawn: the SDK transport's argv construction plus `buildEnvironment` (gateway base URL/auth, attribution headers, `ENABLE_TOOL_SEARCH`, session-state events)
  - `driver.rs` — the ACP agent surface (`initialize`, `session/new`, `session/prompt` with steer + turn queue, cancel, mode changes, `_posthog/refresh_session` via `--resume` respawn), the `canUseTool` permission relay port (mode gating, plan mode, AskUserQuestion, domain allowlist, PostHog exec sub-tool gate), and the hook chain (subagent rewrite, signed-commit guard, Task* plan updates, PostToolUse toolResponse reporting)
  - `convert.rs` — SDK message → ACP session-update conversion (`sdk-to-acp.ts` / `tool-use-to-acp.ts` port): partial-message streaming with consolidated-copy dedupe, tool_call/tool_result mapping, Task*→plan suppression, result → stopReason/error classification
  - `prompt.rs` — ACP prompt → SDK user message (`acp-to-sdk.ts` port), path-only file attachments, steer priority
  - the local tools are served in-process from `crates/agent-tools` over the CLI's `mcp_message` control channel
  - `src/bin/mock_claude_cli.rs` — scripted Claude CLI used by the driver e2e tests
- `crates/codex-driver` — the native codex driver binary (`codex-acp-driver`), phase 2:
  - `rpc.rs` — the app-server's JSON-RPC framing (ndjson without the `jsonrpc` header, string-or-number ids, concurrent server-request dispatch)
  - `spawn.rs` — `codex app-server` spawn: the `buildAppServerArgs` config pins (plugins off, file credential stores, danger-full-access sandbox, the PostHog gateway model provider) and binary resolution from `@openai/codex`'s vendored platform package
  - `driver.rs` — the ACP agent surface (`initialize`, `session/new` via `thread/start`, `session/prompt` via `turn/start` with `turn/steer` folding, cancel via `turn/interrupt`, config options), the approval relays (`approvals.ts` port: command/file-change approvals with codex's remember decisions, requestUserInput questions, permission-profile grants, MCP elicitations — all failing closed), compaction status/boundary, usage + turn_complete + structured-output notifications
  - `mapping.rs` — app-server notification → ACP session-update conversion (`mapping.ts` port): delta streaming, item→tool_call mapping with read/search/execute classification, unified-diff → ACP diff blocks, plan updates
  - `modes.rs` — mode synthesis (`session-config.ts` port): plan/read-only/auto/full-access presets applied per-turn as `approvalPolicy` + `collaborationMode` (+ sandbox/permission-profile off-cloud), and the synthesized configOptions picker
  - `local_tools_stdio.rs` — the signed-git tools as codex's stdio MCP server: the driver binary re-invoked with `--local-tools-mcp` (the `local-tools-mcp-server.js` port)
  - `src/bin/mock_codex_app_server.rs` — scripted app-server used by the driver e2e tests

The Node sidecar entry lives in `packages/agent/src/server/acp-stdio-bin.ts` (published as the `posthog-acp-claude` bin): the existing `ClaudeAcpAgent`/codex proxy wired to stdio, with no HTTP, tapping, or log writer — the Rust server owns those. It remains the default adapter for both runtimes until the native drivers are switched on.

## Contracts that must not drift

Django (`products/tasks` in posthog/posthog) and clients observe exactly:

1. `GET /health` → `{"status":"ok","hasSession":bool,"bootMs":n?,"sessionInitMs":n?}`
2. `POST /command` — JSON-RPC 2.0; methods `user_message`, `cancel`, `close`, `set_config_option`, `refresh_session`, `permission_response` (plus `posthog/`- and `_posthog/`-prefixed aliases); `-32602` for invalid params, `-32000` for execution errors, HTTP 400 `{"error":"Invalid JSON-RPC request"}` / `{"error":"No active session for this run"}`
3. `GET /events` — SSE `data: {json}\n\n` frames + `: keepalive\n\n` every 25s; `{"type":"connected"}` handshake; `{"type":"notification","timestamp","notification"}` envelopes; `{"type":"permission_request",...}` relays; events buffered until the first client attaches, then replayed in order
4. Event ingest — NDJSON `{"seq":n,"event":{...}}` onto a chunked POST (Django `event_stream/` or proxy `/v1/runs/{id}/ingest`), seq-sync handshake, 409 rebase, `{"type":"_posthog/stream_complete","final_seq":n}` sentinel
5. JWT — RS256, audience `posthog:sandbox_connection`, error codes `invalid_token` / `expired` / `invalid_signature` / `server_error`
6. CLI — every flag and env var `bin.ts` accepts, with the same validation messages
7. The `_posthog/*` notification surface and the cloud system prompt text

The e2e suite (`crates/agent-server/tests/e2e.rs`) exercises these against a real subprocess; the module unit tests pin the shapes.

## Build, test, run

```bash
cd rust
cargo build
cargo test
cargo clippy --all-targets
cargo fmt --check
```

Full-stack smoke against the real Node sidecar (build `@posthog/agent` first with `pnpm turbo build --filter=@posthog/agent`):

```bash
JWT_PUBLIC_KEY="$(cat crates/agent-server/tests/fixtures/test_jwt_public.pem)" \
POSTHOG_API_URL="http://127.0.0.1:18099" \
POSTHOG_PERSONAL_API_KEY="phx_dev" \
POSTHOG_PROJECT_ID="2" \
./target/debug/agent-server \
  --port 18098 --mode background --taskId task_1 --runId run_1 \
  --adapterCmd "node ../packages/agent/dist/server/acp-stdio.cjs"
```

(Point `POSTHOG_API_URL` at a real or mock PostHog API; with an empty task description the session initializes without an LLM call.)

## Ported in phase 1.5

- summary session resume (`POSTHOG_RESUME_RUN_ID` / `resume_from_run_id`): prior-run log fetch, conversation rebuild, token-budgeted summary prompt (`resume.rs`)
- git handoff checkpoints, capture and apply (`checkpoint.rs`): checkpoint commits via plumbing, >1 MiB blob reconciliation, `pack-objects` artifacts, branch restore with divergence detection
- skill bundle installation (sha256 + unzip with traversal protection) and artifact attachment hydration to `resource_link` blocks (`artifacts.rs`), including `/skill` invocation context
- pending user prompts, initial-prompt overrides, and the prewarmed-run auto-publish upgrade from run state

## Ported in phase 2 (`crates/claude-driver`)

- the SDK's stream-json control protocol against the Claude Code CLI: initialize handshake (hooks, in-process MCP servers, system prompt, `ph-explore` subagent), `can_use_tool`, `hook_callback`, `mcp_message`, `interrupt`, `set_permission_mode`
- the full `canUseTool` dispatch from `permissions/permission-handlers.ts`: domain allowlist, PostHog exec destructive sub-tool re-gate, mode gating, EnterPlanMode/ExitPlanMode (plan validation + mode-change approval options), AskUserQuestion (option relay, parked-question denial, answers injection), plan-file exception, default relay flow with allow_always permission persistence
- the cloud hook chain: Explore→ph-explore subagent rewrite, the signed-commit guard, TaskCreated/TaskCompleted plan updates, and PostToolUse `toolResponse` reporting (the agent-server's git-checkpoint trigger)
- the signed-git local tools (`git_signed_commit` / `git_signed_merge` / `git_signed_rewrite`) as an in-process MCP server over the control channel — byte-compatible descriptions, schemas, guards, and result texts with `@posthog/git/signed-commit`, including live `/tmp/agent-env` token refresh and best-effort commit-artefact reporting
- turn steering (`_meta.steer` → priority "next"), turn queueing, cancellation, usage/structured-output/sdk-session extension notifications, and `_posthog/refresh_session` as a `--resume` respawn with fresh MCP servers

## Ported in phase 2 (`crates/codex-driver`)

- the codex app-server JSON-RPC protocol: initialize handshake (`experimentalApi`), `thread/start` with the PostHog gateway model provider and per-thread MCP servers, `turn/start` with per-turn `approvalPolicy` / `collaborationMode` / `outputSchema` (+ sandbox and permission profiles off-cloud), `turn/steer` folding with rotated-turn-id adoption, `turn/interrupt` with late-completion dropping
- every server-initiated request from `approvals.ts`: command/file-change approvals (including codex's `approved_execpolicy_amendment` / `approved_for_session` remember decisions and reject-with-feedback steering), `requestUserInput` question relays, permission-profile grants scoped to the turn, and MCP elicitations — all failing closed on error or cancel
- the notification mapping (`mapping.ts`): message/reasoning deltas, item→tool_call with read/search/execute classification, command output streaming, unified-diff parsing, plan updates, token-usage gauge + `_posthog/usage_update` breakdown, compaction status/boundary, `_posthog/turn_complete`, structured-output parsing from the final message
- the signed-git local tools as codex's stdio MCP server (the driver binary re-invoked with `--local-tools-mcp`), backed by the same `crates/agent-tools` implementation the Claude driver serves in-process

## Native resume

Full port of `prepareNativeResume`: when a run resumes and the prior run's ACP session can be continued natively, the server sends `_posthog/session/resume` instead of `session/new` + summary prompt, and the first turn is just "Continue from where you left off".

- Claude: the session JSONL is reused when it survived a snapshot restore (warm — the git checkpoint is skipped too), or hydrated from the prior run's log into the Claude transcript format (`jsonl-hydration.ts` port in `resume.rs` + the shared path/sanitize helpers in `agent-tools/src/session_jsonl.rs`); the driver respawns the CLI with `--resume <sessionId>` and rebuilds the plan panel from the transcript (`rehydrateTaskState`)
- codex: warm-only — `thread/resume` when a `rollout-*-<threadId>.jsonl` exists under `CODEX_HOME/sessions` (there is no cold hydration equivalent)
- summary resume remains the fallback whenever no prior session id is known, hydration finds nothing, or the native resume request fails

## Non-goals (verified against the TS cloud server)

These were listed as gaps but turn out not to apply to the cloud server this workspace replaces:

- OTEL log export (`/i/v1/agent-logs`): `OtelLogWriter` in `packages/agent` has no callers — only the desktop app exports OTLP, via its own `apps/code` transport. The cloud log path is the `append_log` API, which is ported.
- local log cache + its tool-update coalescing: the cloud server constructs `SessionLogWriter` without a `localCachePath`; the cache (and the per-toolCallId merged-update coalescing that feeds it) is a desktop-only load cache. The API-path coalescing the cloud actually uses is ported.
- file-read enrichment (tree-sitter, `packages/enricher`): explicitly disabled in the cloud sidecar (`enricherEnabled: false` in `acp-stdio-bin.ts`), so the drivers are at parity with cloud production. A native port is feasible if ever wanted (tree-sitter is Rust-first) but is its own project.

## Release and rollout

`agent-server-rust-release.yml` builds static musl binaries (`x86_64`/`aarch64`) of `agent-server`, `claude-acp-driver`, and `codex-acp-driver` with a `SHA256SUMS` file on `agent-server-rs-v*` tags.
The sandbox image (`Dockerfile.sandbox-base` in posthog/posthog) installs pinned, checksum-verified releases to `/usr/local/bin/` when the `RUST_AGENT_SERVER_TAG` build args are set.
Django switches each layer independently:

- `SANDBOX_RUST_AGENT_SERVER` swaps the launch command onto the Rust server (`agent_server_launch_binary()` in `products/tasks/backend/logic/services/sandbox.py`)
- `SANDBOX_RUST_CLAUDE_DRIVER` additionally exports `POSTHOG_CLAUDE_ADAPTER_CMD=/usr/local/bin/claude-acp-driver`, which the Rust server applies **only to Claude runs**
- `SANDBOX_RUST_CODEX_DRIVER` exports `POSTHOG_CODEX_ADAPTER_CMD=/usr/local/bin/codex-acp-driver`, applied **only to codex runs** — each adapter keeps the Node sidecar until its own switch is on (adapter resolution in `crates/agent-server/src/config.rs`)
