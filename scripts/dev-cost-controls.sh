#!/usr/bin/env bash
# dev-cost-controls.sh — run & verify the Save Mode / Cost Controls work locally.
#
# Subcommands:
#   check     Preflight: venv, ANTHROPIC_API_KEY, local PostHog (:8010), port :3308
#   test      Run BE (gateway) + FE (core) unit tests + lints  [no stack needed]
#   gateway   Start the LLM gateway on :3308 against local PostHog (cache-TTL wire is live)
#   help      This message
#
# Repos are assumed siblings; override with env vars:
#   POSTHOG_DIR (default ~/Developer/posthog)   CODE_DIR (default ~/Developer/code)
#
# Full flow (4 terminals, in order):
#   1) cd ~/Developer/posthog && hogli dev:setup   # pick: Postgres, Redis, ClickHouse, Django/API
#      then: hogli start                            # (first run also: hogli dev:reset)
#   2) ./scripts/dev-cost-controls.sh test          # confirm everything is green
#   3) ANTHROPIC_API_KEY=sk-ant-... ./scripts/dev-cost-controls.sh gateway
#   4) cd ~/Developer/code && pnpm dev              # then pick the "Dev" region at login
set -euo pipefail

POSTHOG_DIR="${POSTHOG_DIR:-$HOME/Developer/posthog}"
CODE_DIR="${CODE_DIR:-$HOME/Developer/code}"
GW_DIR="$POSTHOG_DIR/services/llm-gateway"
PY="$GW_DIR/.venv/bin/python"

c_ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
c_warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
c_err() { printf '  \033[31m✗\033[0m %s\n' "$1"; }
hr() { printf '\n=== %s ===\n' "$1"; }

cmd_check() {
  hr "Preflight"
  [ -x "$PY" ] && c_ok "gateway .venv present" || c_err "no gateway .venv — run: cd $GW_DIR && uv sync"
  [ -n "${ANTHROPIC_API_KEY:-}" ] && c_ok "ANTHROPIC_API_KEY set" || c_warn "ANTHROPIC_API_KEY unset (gateway can't proxy)"
  if curl -fsS -m 2 http://localhost:8010/_health >/dev/null 2>&1 || curl -fsS -m 2 http://localhost:8010 >/dev/null 2>&1; then
    c_ok "local PostHog reachable on :8010"
  else
    c_warn "local PostHog NOT reachable on :8010 — start it: cd $POSTHOG_DIR && hogli start"
  fi
  if nc -z -w1 localhost 3308 >/dev/null 2>&1; then
    c_warn "port :3308 already in use (gateway may already be running)"
  else
    c_ok "port :3308 free"
  fi
}

cmd_test() {
  hr "BE — gateway unit tests + lints"
  cd "$GW_DIR"
  "$PY" -m pytest tests/test_cost_efficiency.py tests/test_batch_routing.py \
    tests/test_budget_guard.py tests/test_cost_controls.py tests/test_cache_ttl.py -q
  .venv/bin/ruff check src/llm_gateway/cost_efficiency.py src/llm_gateway/batch_routing.py \
    src/llm_gateway/budget_guard.py src/llm_gateway/cost_controls.py src/llm_gateway/cache_ttl.py \
    src/llm_gateway/api/anthropic.py
  MYPYPATH=src .venv/bin/mypy src/llm_gateway/cost_efficiency.py src/llm_gateway/batch_routing.py \
    src/llm_gateway/budget_guard.py src/llm_gateway/cost_controls.py src/llm_gateway/cache_ttl.py
  c_ok "BE green"

  hr "FE — core unit tests + lint"
  cd "$CODE_DIR"
  pnpm --filter @posthog/core exec vitest run src/save-mode
  node_modules/.bin/biome check packages/core/src/save-mode
  c_ok "FE green"
}

cmd_gateway() {
  cmd_check
  hr "Starting gateway on :3308 (cache-TTL wire live, alpha-gated)"
  cd "$GW_DIR"
  export DATABASE_URL="${DATABASE_URL:-postgres://posthog:posthog@localhost:5432/posthog}"
  export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
  export POSTHOG_HOST="${POSTHOG_HOST:-http://localhost:8010}"
  export POSTHOG_API_BASE_URL="${POSTHOG_API_BASE_URL:-http://localhost:8010}"
  : "${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY before running 'gateway'}"
  if command -v uv >/dev/null 2>&1; then
    exec uv run uvicorn llm_gateway.main:app --reload --port 3308
  else
    exec "$PY" -m uvicorn llm_gateway.main:app --reload --port 3308
  fi
}

case "${1:-help}" in
  check) cmd_check ;;
  test) cmd_test ;;
  gateway) cmd_gateway ;;
  *) sed -n '2,25p' "$0" ;;
esac
