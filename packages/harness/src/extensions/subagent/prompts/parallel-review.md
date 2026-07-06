---
description: Run several fresh reviewer subagents in parallel, each with a distinct angle, then synthesize
argument-hint: "[diff or change description]"
---
Use the `subagent` tool in parallel mode to run three `reviewer` subagents concurrently against the following change, each with a distinct angle:

- correctness and edge cases
- test coverage
- cleanup / style / dead code

Change to review: ${1:-the current diff}

After all three complete, synthesize their findings into one prioritized list (must-fix vs. nice-to-have) instead of repeating each reviewer's output verbatim.
