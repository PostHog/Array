---
description: Implement a task with worker, then have reviewer check the change before you report back
argument-hint: "<task>"
---
Use the `subagent` tool in chain mode:

1. `worker` — implement: $ARGUMENTS
2. `reviewer` — review the change described in `{previous}` for correctness, missing tests, and cleanup; apply small fixes directly if needed

If the reviewer's verdict is "changes requested" for anything non-trivial, summarize the outstanding issues for me instead of silently looping.
