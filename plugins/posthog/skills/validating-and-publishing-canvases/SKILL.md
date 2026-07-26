---
name: validating-and-publishing-canvases
description: Validate, preview, and safely publish a PostHog canvas source project. Use after creating or editing any canvas, when repairing build/runtime errors, handling concurrent edits, or checking dependency and capability policy before publication.
---

# Validating and publishing canvases

1. Read the target canvas and record its current source-version ID. Use `null`
   only for a canvas that has never published application source.
2. Validate the complete source project with `canvas-source-validate`. Do not
   supply a custom build command or publish locally generated artifacts.
3. Fix every compile, dependency-policy, capability, CSP, size, and first-render
   error. Revalidate until clean.
4. Preview the candidate artifact when the tool provides one. Exercise its main
   interactions and data paths.
5. Publish exactly once in this run with the complete source project and
   `expectedCurrentVersionId`. Sandbox runs are attributed automatically; only
   pass task and run IDs when the tool explicitly requires them.
6. Never publish a locally built executable artifact. Cloud rebuilds the source
   and is authoritative.
7. If publishing returns `version_conflict`, do not overwrite or retry against
   the stale base. Read the new head and start a fresh edit run that reapplies
   the intent.
8. Report the source version and queued/active build. A failed build must leave
   the last-known-good artifact active.

External network origins are unavailable until canvas capability approval is
implemented. Keep `capabilities.network.origins` empty; use the `ph` SDK for
PostHog data and host-mediated navigation.

For a legacy server that exposes only
`desktop-file-system-canvas-partial-update`, publish one complete React file and
do not claim that an immutable application build was created.
