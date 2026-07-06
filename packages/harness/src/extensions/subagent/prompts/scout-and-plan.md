---
description: Scout the codebase, then have planner turn the findings into an implementation plan
argument-hint: "<task>"
---
Use the `subagent` tool in chain mode to research and plan the following task, without implementing anything yet:

1. `scout` — find the files, entry points, and data flow relevant to: $ARGUMENTS
2. `planner` — using `{previous}` (scout's findings), produce a concrete, ordered implementation plan for: $ARGUMENTS

Report the plan back to me. Do not start implementing until I confirm it.
