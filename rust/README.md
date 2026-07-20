# Rust agent-server

Rust rewrite of the cloud `agent-server` from `@posthog/agent` (`packages/agent/src/server/`).
The TypeScript server wraps two full Node processes around every cloud run; this workspace replaces the outer one with a static binary while keeping every wire contract byte-compatible, so Django and clients cannot tell the implementations apart.

```text
before                                 phase 1                                   phase 2 (Claude runs)
──────                                 ───────                                   ─────────────────────
node agent-server (~150-400 MB RSS)    agent-server (Rust, ~10-25 MB RSS)        agent-server (Rust)
│  Hono HTTP /health /events /command  │  axum HTTP /health /events /command     │
│  4× NDJSON tap layers                │  parse-once bus → SSE/ingest/log sinks  │
│  event ingest, JWT, logs, session    │  event ingest, JWT, logs, session       │
└─ claude-agent-sdk (in-process)       └─ posthog-acp-claude sidecar (Node)      └─ claude-acp-driver (Rust)
   └─ claude CLI subprocess               └─ claude CLI subprocess                  └─ claude CLI subprocess
```

Phase 2 replaces the Node sidecar for Claude runs with `claude-acp-driver`, a native crate speaking the Claude Code CLI's stream-json control protocol directly (the same wire protocol `@anthropic-ai/claude-agent-sdk` speaks) — no PostHog Node process is left in the tree. Codex runs keep the Node sidecar for now: `codex app-server` is already a native binary, but its ACP translation layer (`codex-app-server-agent.ts`) has not been ported yet.

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
- `crates/claude-driver` — the native Claude driver binary (`claude-acp-driver`), phase 2:
  - `transport.rs` — the CLI's stream-json control protocol (`control_request`/`control_response` correlation, concurrent handler dispatch)
  - `cli.rs` — CLI spawn: the SDK transport's argv construction plus `buildEnvironment` (gateway base URL/auth, attribution headers, `ENABLE_TOOL_SEARCH`, session-state events)
  - `driver.rs` — the ACP agent surface (`initialize`, `session/new`, `session/prompt` with steer + turn queue, cancel, mode changes, `_posthog/refresh_session` via `--resume` respawn), the `canUseTool` permission relay port (mode gating, plan mode, AskUserQuestion, domain allowlist, PostHog exec sub-tool gate), and the hook chain (subagent rewrite, signed-commit guard, Task* plan updates, PostToolUse toolResponse reporting)
  - `convert.rs` — SDK message → ACP session-update conversion (`sdk-to-acp.ts` / `tool-use-to-acp.ts` port): partial-message streaming with consolidated-copy dedupe, tool_call/tool_result mapping, Task*→plan suppression, result → stopReason/error classification
  - `prompt.rs` — ACP prompt → SDK user message (`acp-to-sdk.ts` port), path-only file attachments, steer priority
  - `signed_git.rs` + `gh.rs` + `artefacts.rs` — full port of `@posthog/git/signed-commit`: `createCommitOnBranch` commits/rewrites/merges with every guard (mid-operation, behind-remote, base-leak) and commit-artefact reporting
  - `mcp.rs` — the in-process `posthog-code-tools` MCP server answering `tools/list`/`tools/call` over the CLI's `mcp_message` control channel
  - `src/bin/mock_claude_cli.rs` — scripted Claude CLI used by the driver e2e tests

The Node sidecar entry lives in `packages/agent/src/server/acp-stdio-bin.ts` (published as the `posthog-acp-claude` bin): the existing `ClaudeAcpAgent`/codex proxy wired to stdio, with no HTTP, tapping, or log writer — the Rust server owns those. It remains the default adapter and the codex path.

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

## Remaining gaps

- codex runs still use the Node sidecar (`codex app-server` is native, but its ACP mapping layer is not ported)
- native resume (Claude session JSONL hydration / `session/load`) — summary resume is the fallback the TS server also uses when hydration is unavailable
- file-read enrichment (tree-sitter) — disabled in the sidecar, not ported to the driver
- OTEL log export (`/i/v1/agent-logs`) — only the `append_log` API path is ported
- tool-update coalescing for the local log cache (API-path coalescing is ported)

## Release and rollout

`agent-server-rust-release.yml` builds static musl binaries (`x86_64`/`aarch64`) of both `agent-server` and `claude-acp-driver` with a `SHA256SUMS` file on `agent-server-rs-v*` tags.
The sandbox image (`Dockerfile.sandbox-base` in posthog/posthog) installs pinned, checksum-verified releases to `/usr/local/bin/agent-server-rs` and `/usr/local/bin/claude-acp-driver` when the `RUST_AGENT_SERVER_TAG` build args are set.
Django switches each layer independently:

- `SANDBOX_RUST_AGENT_SERVER` swaps the launch command onto the Rust server (`agent_server_launch_binary()` in `products/tasks/backend/logic/services/sandbox.py`)
- `SANDBOX_RUST_CLAUDE_DRIVER` additionally exports `POSTHOG_CLAUDE_ADAPTER_CMD=/usr/local/bin/claude-acp-driver`, which the Rust server applies **only to Claude runs** — codex runs keep the Node sidecar even when the variable is set (adapter resolution in `crates/agent-server/src/config.rs`)
