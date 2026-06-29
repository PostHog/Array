#!/usr/bin/env bash
# Run the live golden-path e2e for both adapters (claude + codex).
#
# Needs a local llm-gateway (run `./bin/start` in the posthog repo) and an OAuth
# token it accepts. If E2E_GATEWAY_TOKEN is unset, this mints a short-lived one
# from the posthog repo (override its path with POSTHOG_REPO).
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
  if [[ ! -d "$POSTHOG_REPO" ]]; then
    echo "E2E_GATEWAY_TOKEN unset and posthog repo not found at $POSTHOG_REPO." >&2
    echo "Set E2E_GATEWAY_TOKEN, or POSTHOG_REPO to the posthog checkout." >&2
    exit 1
  fi
  echo "Minting a local-gateway OAuth token from $POSTHOG_REPO ..."
  MINT='from posthog.models import User; from products.tasks.backend.logic.services.code_usage_gate import create_oauth_access_token_for_user; print(create_oauth_access_token_for_user(User.objects.get(id=1), 1, scopes=["llm_gateway:read"], include_internal_scopes=False))'
  E2E_GATEWAY_TOKEN="$(cd "$POSTHOG_REPO" && flox activate -- bash -c ".venv/bin/python manage.py shell -c '$MINT'" 2>/dev/null | grep -oE 'pha_[A-Za-z0-9]+' | head -1)"
fi

if [[ -z "${E2E_GATEWAY_TOKEN:-}" ]]; then
  echo "Failed to obtain an E2E_GATEWAY_TOKEN." >&2
  exit 1
fi

export E2E_GATEWAY_TOKEN
echo "token: ${E2E_GATEWAY_TOKEN:0:8}…  gateway: ${E2E_GATEWAY_URL:-http://localhost:3308/posthog_code}"
cd "$AGENT_DIR"
pnpm test:e2e "$@"
