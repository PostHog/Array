#!/usr/bin/env bash
# Run the live golden-path e2e for both adapters (claude + codex).
#
# Needs a local llm-gateway (run `./bin/start` in the posthog repo) and a token.
# The suite targets the gateway's `llm_gateway` product, which accepts a personal
# API key (no OAuth), so if E2E_GATEWAY_TOKEN is unset this reads the repo's
# hardcoded local dev key from ee/settings.py (override the repo with POSTHOG_REPO).
# That key must be registered in the local DB — run `python manage.py
# setup_local_api_key` in the posthog repo once if auth fails.
#
# Usage:
#   bash e2e/run-e2e.sh              # both adapters, both suites
#   bash e2e/run-e2e.sh -t "(codex)" # only the codex arm (vitest -t name filter)
# Env overrides: E2E_GATEWAY_URL, E2E_CLAUDE_MODEL, E2E_CODEX_MODEL, E2E_DEBUG=1
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$HERE/.." && pwd)"
POSTHOG_REPO="${POSTHOG_REPO:-$(cd "$AGENT_DIR/../../.." && pwd)/posthog}"

if [[ -z "${E2E_GATEWAY_TOKEN:-}" ]]; then
  SETTINGS="$POSTHOG_REPO/ee/settings.py"
  if [[ ! -f "$SETTINGS" ]]; then
    echo "E2E_GATEWAY_TOKEN unset and posthog settings not found at $SETTINGS." >&2
    echo "Set E2E_GATEWAY_TOKEN, or POSTHOG_REPO to the posthog checkout." >&2
    exit 1
  fi
  # The `llm_gateway` product accepts personal API keys, so no OAuth mint needed.
  E2E_GATEWAY_TOKEN="$(grep -E '^DEV_API_KEY[[:space:]]*=' "$SETTINGS" | head -1 | sed -E 's/^DEV_API_KEY[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/')"
fi

if [[ -z "${E2E_GATEWAY_TOKEN:-}" ]]; then
  echo "Failed to obtain an E2E_GATEWAY_TOKEN (no DEV_API_KEY in ee/settings.py?)." >&2
  echo "If auth then fails, run 'python manage.py setup_local_api_key' in the posthog repo." >&2
  exit 1
fi

export E2E_GATEWAY_TOKEN
echo "token: ${E2E_GATEWAY_TOKEN:0:8}…  gateway: ${E2E_GATEWAY_URL:-http://localhost:3308/llm_gateway}"
cd "$AGENT_DIR"
pnpm test:e2e "$@"
