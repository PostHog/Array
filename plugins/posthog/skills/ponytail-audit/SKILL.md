---
name: ponytail-audit
description: Audit the whole repository — not just the current diff — for over-engineering and hand back a prioritized delete-list. Use when the user asks to find bloat, dead code, needless abstractions, or unused dependencies across the codebase, or invokes ponytail-audit. For reviewing only the current uncommitted change use ponytail-review instead.
---

<!-- Adapted from Ponytail (https://github.com/DietrichGebert/ponytail), MIT. -->

# Ponytail audit: find over-engineering across the repo

Audit the codebase for over-engineering and return a prioritized delete-list.
Because the scope is the whole repo, prioritize — biggest, safest deletions
first — rather than trying to be exhaustive in one pass.

## Scope

The whole repository, not just the diff (that is ponytail-review).

## What to hunt for

- Dead code: unused exports, unreferenced files, unreachable branches.
- Abstractions with a single caller — inline them.
- Duplicated logic that could collapse to one shared function, fixed at the root.
- Unused or redundant dependencies.
- Speculative generality: config, flags, or options nobody uses.
- Boilerplate repeated by hand that a stdlib or native platform feature already covers.

## Verify before recommending a deletion

- `grep` for callers and imports before calling something unused.
- Confirm a dependency is truly unreferenced before flagging it.
- Never flag input validation, error handling, security, accessibility, or explicitly requested behavior.

## Output

A prioritized list. Each item: location, why it is removable, the evidence (no
callers, duplicate of X), estimated lines saved, and the risk. Highest-value,
lowest-risk first. Recommend; do not delete without the user's go-ahead.
