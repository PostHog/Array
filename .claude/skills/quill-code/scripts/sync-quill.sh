#!/usr/bin/env bash
# Build local @posthog/quill, pack it to a content-hashed tarball, point the
# pnpm override at it, and reinstall. See SKILL.md for the why.
set -euo pipefail

# code repo root = dir containing pnpm-workspace.yaml, walking up from this script
CODE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && while [ ! -f pnpm-workspace.yaml ] && [ "$PWD" != / ]; do cd ..; done && pwd)"
[ -f "$CODE_ROOT/pnpm-workspace.yaml" ] || { echo "could not find pnpm-workspace.yaml above $0" >&2; exit 1; }

QUILL_DIR="${QUILL_DIR:-$CODE_ROOT/../posthog/packages/quill/packages/quill}"
[ -d "$QUILL_DIR" ] || { echo "quill source not found: $QUILL_DIR (set QUILL_DIR=...)" >&2; exit 1; }

# The quill workspace root (@posthog/quill-workspace) is two levels up from the
# aggregate package. We MUST build there: its `pnpm build` runs the recursive
# `pnpm -r --filter '@posthog/quill-*' --filter '@posthog/quill' build`, which
# rebuilds the sub-packages (primitives, components, blocks, ...) BEFORE the
# aggregate bundles them. Building inside QUILL_DIR alone only re-bundles the
# sub-packages' STALE dist, so edits to blocks/primitives/etc. are silently lost.
QUILL_WS="${QUILL_WS:-$(cd "$QUILL_DIR/../.." && pwd)}"

DEST="$CODE_ROOT/.local-quill"
WS="$CODE_ROOT/pnpm-workspace.yaml"

echo "==> building quill workspace in $QUILL_WS"
( cd "$QUILL_WS" && pnpm build )

echo "==> packing tarball -> $DEST"
mkdir -p "$DEST"
( cd "$QUILL_DIR" && npm pack --pack-destination "$DEST" >/dev/null )

RAW="$(ls -t "$DEST"/posthog-quill-*.tgz | grep -v -- '-local-' | head -1)"
[ -n "$RAW" ] || { echo "npm pack produced no posthog-quill-*.tgz" >&2; exit 1; }

HASH="$(md5 -q "$RAW" | cut -c1-8)"
HASHED="posthog-quill-local-$HASH.tgz"
cp "$RAW" "$DEST/$HASHED"
rm -f "$RAW"
# drop stale local tarballs so the pnpm store can't resolve an old integrity
find "$DEST" -name 'posthog-quill-local-*.tgz' ! -name "$HASHED" -delete

echo "==> pointing override at .local-quill/$HASHED"
# single override line: '@posthog/quill': file:./.local-quill/...
sed -i '' -E "s#('@posthog/quill': file:\./\.local-quill/)[^']*#\1$HASHED#" "$WS"
grep -q "$HASHED" "$WS" || { echo "failed to rewrite override line in $WS" >&2; exit 1; }

echo "==> pnpm install"
( cd "$CODE_ROOT" && pnpm install )

echo "==> done. @posthog/quill now resolves to .local-quill/$HASHED"
