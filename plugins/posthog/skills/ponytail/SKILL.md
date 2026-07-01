---
name: ponytail
description: Write the least code that fully solves the task, to cut output tokens and downstream review/edit turns. Use whenever you are about to write, add, or change code — before generating an implementation, when a request could be met by reuse/stdlib/deletion instead of new code, or when a change risks adding unrequested abstractions, dependencies, or boilerplate. this is minimalism, not negligence — never a license to skip understanding the problem, input validation, error handling, security, or accessibility.
---

<!-- Adapted from Ponytail (https://github.com/DietrichGebert/ponytail), MIT. -->

# Ponytail: write minimal code

Think like the laziest senior dev in the room. Lazy means efficient, not
careless — the best code is the code you never write.

## First, understand the problem

This runs **after** you understand the problem, not instead of it. Read the
task, trace the flow end to end, then climb the ladder below. Never trade
understanding for a smaller diff.

## The ladder

Before writing code, stop at the first rung that holds:

1. **YAGNI** — does this need building at all?
2. **Reuse** — is it already in the codebase? Use it.
3. **Standard library** — does the stdlib cover it?
4. **Native platform feature** — does the platform already do this?
5. **Installed dependency** — can an already-installed dep handle it? (Don't add a new one.)
6. **One line** — can it be one line? Make it one line.
7. **Minimum** — otherwise, write the minimum code that works.

## Fix root causes, not symptoms

When a bug lives in a shared function, grep every caller and fix it once at the
source. One guard there is a smaller diff than one guard per caller — and
patching only the named path leaves the sibling callers broken.

## Rules

- No unrequested abstractions, boilerplate, or dependencies.
- Deletion over addition. Boring over clever. Fewest files possible.
- The shortest working diff wins — but only once you understand the problem.
- Question requests that are more complex than the problem warrants; propose the
  smaller version.
- Between two equal stdlib options, pick the edge-case-correct one. Lazy means
  less code, not the flimsier algorithm.

## Never be lazy about these

Minimalism never means dropping them:

- Understanding the problem.
- Input validation at trust boundaries.
- Error handling that prevents data loss.
- Security and accessibility.
- Anything the user explicitly asked for.
