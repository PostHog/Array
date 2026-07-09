---
name: subagent-orchestration
description: How and when to delegate work to subagents via the `subagent` tool (Explore, Plan). Use when a task involves codebase recon or implementation planning that would benefit from an isolated, read-only context window instead of doing it all inline.
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
- **Parallelizable**: several independent instances of it can run at once (e.g. exploring
  two unrelated areas of a large codebase in the same turn).

Do not delegate trivial one-line changes, or work that fundamentally needs your full
conversation context to do correctly — that's what `context` (below) is for, but if
almost everything is relevant, delegation adds overhead for no benefit.

## Bundled agents

| Agent | Use for | Tools | Model | Notes |
|-------|---------|-------|-------|-------|
| `Explore` | Fast, read-only recon: find files, entry points, data flow | read, bash, grep, find, ls | Fast/cheap model, falls back to your current model | Reports compressed findings, never edits |
| `Plan` | Turn Explore's findings (or your own) into a concrete implementation plan | read, bash, grep, find, ls | Inherits your current model | Never edits |

Both bundled agents are read-only. There is no bundled agent that writes — do any actual
editing yourself, in the parent session, after Explore/Plan give you what you need.

Subagents cannot themselves call `subagent` — they are leaves, not orchestrators. Keep
all delegation decisions in your own (parent) session.

A project can add its own agents (including ones that write) as `.pi/agents/<name>.md`
files — same frontmatter convention as the bundled agents above. See `agentScope` below.

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
  that can run at once, e.g. `Explore`ing two unrelated parts of a codebase together.

There is no chain mode. For a fixed pipeline (e.g. explore then plan), just call
`subagent` twice in sequence yourself and pass the first call's output back in as the
second call's `context` — you are already the orchestrator holding both results.

## Recommended pattern

```
clarify -> Explore -> Plan -> implement it yourself -> confirm before any risky follow-up
```

This is guidance, not a rigid workflow — decide per task whether you need both steps. For
a small, well-understood change, skip straight to implementing it yourself.

## Observability

Every run writes `status.json`, `events.jsonl`, and a full `transcript.md` to
`~/.pi/agent/subagent-runs/<runId>/` for later inspection.
