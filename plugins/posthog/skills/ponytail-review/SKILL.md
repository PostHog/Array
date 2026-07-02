---
name: ponytail-review
description: Review the current uncommitted diff for over-engineering and hand back a concrete delete-list. Use when the user asks to review a change for bloat, wants a pass to cut unnecessary code before committing, or invokes ponytail-review. Focuses only on what to remove or simplify, never on finding bugs. For a whole-repo pass use ponytail-audit.
---

<!-- Adapted from Ponytail (https://github.com/DietrichGebert/ponytail), MIT. -->

# Ponytail review: cut over-engineering from the diff

Review only the current uncommitted changes for over-engineering and return a
delete-list — concrete lines and blocks to remove or collapse — not prose. This
is a minimalism pass, not a bug hunt.

## Scope

Read `git diff` and `git diff --staged`. Judge only the added and changed hunks,
not the rest of the repo (that is ponytail-audit).

## What to flag

Apply the minimalism ladder from the `ponytail` skill to every added hunk:

- Abstractions, layers, or indirection introduced for a single caller.
- New helpers or utilities that duplicate something already in the codebase or stdlib.
- Unrequested config, options, flags, or generality nobody asked for.
- Boilerplate, dead code, commented-out code, error paths for impossible states.
- A new dependency where an installed one or the stdlib would do.
- Multi-line constructs that collapse to one line without losing clarity or correctness.
- Comments that just restate the code.

## What to leave alone

Never put these on the chopping block:

- Input validation at trust boundaries, error handling that prevents data loss, security, accessibility.
- Anything the user explicitly asked for.
- Correctness edge cases — fewer lines is not worth a flimsier algorithm.

## Output

For each finding: `file:line`, what to cut, and the smaller replacement. End with
the net line delta if the delete-list is applied. If the diff is already minimal,
say so in one line — don't invent work.
