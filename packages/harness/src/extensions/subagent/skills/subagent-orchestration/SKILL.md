---
name: subagent-orchestration
description: How and when to delegate work to subagents via the `subagent` tool (scout, planner, reviewer, worker, oracle). Use when a task involves codebase recon, planning, implementation, review, or a second opinion that would benefit from an isolated context window instead of doing it all inline.
---

# Subagent Orchestration

You (the parent session) can delegate scoped work to focused subagents, each running in
its own isolated pi process with its own context window. Use this to keep your own
context clean and to parallelize independent work.

## When to delegate

Delegate when a piece of work is:
- **Self-contained**: it doesn't need your full conversation history, just a task and
  some context you can state explicitly.
- **Isolable**: it would otherwise burn a lot of your context window (e.g. broad codebase
  search, reading many files) for a result you can summarize down to a few paragraphs.
- **Parallelizable**: several independent instances of it can run at once (e.g. reviewing
  three different concerns on the same diff).
- **A second opinion**: you want a fresh, less-anchored perspective before committing to
  a plan or a fix.

Do not delegate trivial one-line changes, or work that fundamentally needs your full
conversation context to do correctly — that's what `context` (below) is for, but if
almost everything is relevant, delegation adds overhead for no benefit.

## Bundled agents

| Agent | Use for | Tools | Notes |
|-------|---------|-------|-------|
| `scout` | Fast, read-only recon: find files, entry points, data flow | read, grep, find, ls, bash | Reports compressed findings, never edits |
| `planner` | Turn scout's findings (or your own) into a concrete implementation plan | read, grep, find, ls | Never edits |
| `worker` | General-purpose implementation | full default toolset | Only agent that writes by default |
| `reviewer` | Review a diff/change for correctness, tests, cleanup | read, grep, find, ls, bash | Can apply small fixes |
| `oracle` | Second opinion / challenge assumptions before a risky decision | read, grep, find, ls | Never edits |

Subagents cannot themselves call `subagent` — they are leaves, not orchestrators. Keep
all delegation decisions in your own (parent) session.

## The `context` field — always fill it in

A subagent gets **only** its `task` string, plus a small automatic digest of your last
few conversation turns (as a fallback, not a substitute). It does not see the files
you've already read, tool results you've already seen, or decisions you've already made
unless you put them in `context`.

**Always pass `context`** with whatever the subagent actually needs:
- File paths and line numbers you already found.
- Decisions already made ("use approach B, not A, because...").
- Constraints ("don't touch files under vendor/").

A subagent given a bare one-line `task` and no `context` will waste its own turns
re-discovering things you already know.

## Modes

- **single** — one agent, one task. Default choice.
- **parallel** — `tasks: [...]`, up to 8 tasks / 4 concurrent. Use for independent work
  that can run at once, e.g. three reviewers each checking a different concern on the
  same diff.
- **chain** — `chain: [...]`, sequential steps where each step's task can reference
  `{previous}` (the prior step's final output). Use for a fixed pipeline like
  scout → planner → worker.
- **background: true** — any of the above, but returns immediately with a `runId`
  instead of waiting. Check on it later with `/subagents-fleet`, or ask "check run
  `<id>`" / "interrupt run `<id>`". Only use this for genuinely long-running work you
  don't need to block on — you cannot answer the child's `contact_supervisor`
  questions once it's running in the background.

## Recommended pattern

```
clarify -> scout -> planner -> worker -> fresh reviewer(s) -> worker (if changes requested)
```

This is guidance, not a rigid workflow — decide per task whether you need all of these
steps. For small changes, `worker` alone (or `worker` then one `reviewer`) is enough.

## Observability

- `/subagents-fleet` lists recent and in-progress runs (state, duration, agents).
- `/subagents-fleet interrupt <runId>` aborts a background run.
- Every run writes `status.json`, `events.jsonl`, and a full `transcript.md` to
  `~/.pi/agent/subagent-runs/<runId>/` for later inspection.

## If a subagent contacts you

A running subagent (foreground/parallel/chain, not background) may pause and ask you a
question via `contact_supervisor` if it's blocked or needs a decision it isn't confident
making on its own. When this happens you'll be prompted for a reply inline — answer
directly; there's no special syntax needed.
