# Rust agent-server

Rust rewrite of the cloud `agent-server` from `@posthog/agent` (`packages/agent/src/server/`).
The TypeScript server wraps two full Node processes around every cloud run; this workspace replaces the outer one with a static binary while keeping every wire contract byte-compatible, so Django and clients cannot tell the implementations apart.

```text
before                                    after (phase 1)
──────                                    ───────────────
node agent-server (~150-400 MB RSS)       agent-server (Rust, ~10-25 MB RSS)
│  Hono HTTP /health /events /command     │  axum HTTP /health /events /command
│  4× NDJSON tap layers                   │  parse-once bus → SSE/ingest/log sinks
│  event ingest, JWT, logs, session       │  event ingest, JWT, logs, session
└─ claude-agent-sdk (in-process)          └─ posthog-acp-claude sidecar (Node, ACP over stdio)
   └─ claude CLI subprocess                  └─ claude CLI subprocess
```

Phase 2 replaces the Node sidecar with a native Claude Code driver crate; Codex runs can drop the sidecar earlier since `codex app-server` is already a native binary speaking JSON-RPC on stdio.

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

The Node sidecar entry lives in `packages/agent/src/server/acp-stdio-bin.ts` (published as the `posthog-acp-claude` bin): the existing `ClaudeAcpAgent`/codex proxy wired to stdio, with no HTTP, tapping, or log writer — the Rust server owns those.

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

## Phase 1 gaps

Tracked here so the rollout flag stays off for runs that need them; each is a `TODO(phase-1.5)` in the source:

- session resume (`POSTHOG_RESUME_RUN_ID` / `resume_from_run_id`): logs a warning and starts fresh
- git handoff checkpoints (capture/apply) — the trigger wiring exists, the pack capture is not ported
- skill bundle installation and artifact attachment loading (artifact-only messages surface the missing-attachment notice)
- prewarmed-run auto-publish upgrade and initial-prompt overrides from run state
- file-read enrichment is disabled in the sidecar (tree-sitter WASM assets are not bundled into `acp-stdio.cjs` yet)
- OTEL log export (`/i/v1/agent-logs`) — only the `append_log` API path is ported
- tool-update coalescing for the local log cache (API-path coalescing is ported)

## Rollout

The binary is CLI-compatible: pointing Django's `_build_agent_server_command` at the Rust binary (behind a feature flag, both binaries baked into the sandbox image) is the only integration change. Distribution should follow the `agentsh` pattern in `Dockerfile.sandbox-base` — pinned release, SHA256-verified — via a release workflow building `x86_64/aarch64-unknown-linux-musl`.
