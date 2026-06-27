#!/usr/bin/env bash
set -euo pipefail

MONOREPO=/mnt/c/Users/Abdulbasit/software-engineering/posthog-code/.claude/worktrees/gracious-hawking-38aade
DOCKERFILE=/home/abdulbasit/software-engineering/posthog/products/tasks/backend/sandbox/images/Dockerfile.sandbox-local

echo "==> Removing old posthog-sandbox-base-local image (if any)..."
docker rmi posthog-sandbox-base-local 2>/dev/null || echo "   (no existing image)"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "==> Copying packages to build context at $TMPDIR ..."
cp -r "$MONOREPO/packages/agent"   "$TMPDIR/local-agent"
cp -r "$MONOREPO/packages/shared"  "$TMPDIR/local-shared"
cp -r "$MONOREPO/packages/git"     "$TMPDIR/local-git"
cp -r "$MONOREPO/packages/enricher" "$TMPDIR/local-enricher"

# Remove node_modules to keep the build context lean
find "$TMPDIR" -name node_modules -type d -prune -exec rm -rf {} + 2>/dev/null || true

echo "==> Building posthog-sandbox-base-local ..."
DOCKER_BUILDKIT=1 docker build -f "$DOCKERFILE" -t posthog-sandbox-base-local "$TMPDIR"

echo "==> Done. posthog-sandbox-base-local is ready."
