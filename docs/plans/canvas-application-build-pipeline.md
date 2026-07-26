# Canvas Application Build Pipeline — Implementation Plan

> Status: proposed
> Scope: evolve single-file, runtime-compiled React canvases into built browser
> applications. Support React, Quill, and generic HTML in one application model;
> leave hosted backends and full micro-apps as an explicit future direction.

## Summary

A canvas should be an arbitrary browser application, not a dashboard schema or
a React-only document. The user describes the experience; the agent chooses the
implementation. A single application project can use React, Quill, plain DOM
APIs, WebGL, or any combination, and a build service turns it into an immutable
HTML/CSS/JavaScript artifact.

HTML is the deployment format, not an authoring choice shown to the user or a
separate canvas kind. Requiring agents to hand-author only final HTML would give
up React's component model, Quill's accessibility and design-system behavior,
and build-time validation. Requiring every implementation to use React would add
structure where a static document or direct WebGL program does not need it. One
web-project contract and one build recipe support both without encoding that
implementation decision into product state.

Canvas authoring is also a reusable agent capability. The skills for creating,
building, validating, and publishing a canvas must be available to every task,
not injected only by the canvas composer. A canvas-initiated task invokes the
same skills with a preselected target; an ordinary task can discover and invoke
them when the user asks it to create or update a canvas.

## Goals

- Support arbitrary browser experiences, including data visualizations,
  documents, forms, games, WebGL, Three.js, and other client-only applications.
- Make React, Quill, TypeScript, HTML, CSS, and browser APIs available within one
  canvas application model.
- Compile source ahead of time into an immutable, reproducible browser bundle.
- Validate builds before replacing the last-known-good canvas version.
- Keep PostHog credentials outside generated code and the canvas iframe.
- Make canvas skills discoverable and usable in every local or cloud task.
- Preserve task history, canvas version history, undo, and guarded concurrent
  publishing.
- Keep the architecture open to hosted serverless backends later without
  designing or shipping that runtime now.

## Non-goals

- Hosted functions, databases, secrets, queues, cron, or server-side rendering.
- A public package registry with unrestricted install-time code execution.
- External sharing and its live-data capability proxy. The build artifact should
  be suitable for that future tier, but sharing remains separately scoped.
- A visual page builder or schema-limited component tree.
- Migrating every existing canvas eagerly. Existing single-file React canvases
  continue to render and migrate on their next successful build.

## Product model

### One application model

There is one canvas kind: a browser application. The user is never asked to
choose React versus HTML, and the choice is not persisted as a mode. Every task
can create a canvas, so the decision must work without a canvas-specific
creation screen.

The agent chooses the least complex implementation that meets the request:

- Prefer React + Quill for PostHog data products, forms, application-like state,
  reusable interface components, and experiences that should match PostHog.
- Prefer semantic HTML/CSS and direct browser APIs for static documents, small
  experiments, graphics, and WebGL programs where React adds no useful
  structure.
- Mix them when appropriate. React can own application chrome while Three.js
  owns a canvas element; a mostly static page can mount one interactive React
  island.

These are skill heuristics, not validation rules. The build pipeline treats all
of them as the same web project and produces the same artifact contract. The
agent should not ask the user to choose a framework unless the choice changes a
user-visible requirement that cannot be inferred from the request.

### Canvas source project

Replace `meta.code` as the canonical write format with a small source project:

```ts
interface CanvasSourceProject {
  schemaVersion: 1;
  files: Record<string, string>;
  entryHtml: "index.html";
  dependencies: Record<string, string>;
  canvasSdkVersion: string;
}
```

New canvases start from one intentionally small project:

```text
canvas/
├── package.json
├── index.html
├── src/main.ts
└── src/style.css
```

The starter is neutral: `index.html` loads the entry module, and the entry can
remain vanilla TypeScript or import React and mount an application. React,
Quill, and the canvas SDK are platform-supported dependencies with pinned
versions, but tree-shaking keeps unused code out of the artifact. The agent may
add files and dependencies without changing the canvas's kind.

Dependencies are exact versions resolved by the build service. Lockfile and
resolver metadata belong to the build record, not agent-authored source.

### Build and version records

Source versions and deployable builds are distinct:

```ts
interface CanvasSourceVersion {
  id: string;
  parentVersionId: string | null;
  project: CanvasSourceProject;
  prompt?: string;
  createdAt: number;
}

interface CanvasBuild {
  id: string;
  sourceVersionId: string;
  status: "queued" | "building" | "ready" | "failed";
  artifactUrl?: string;
  integrity?: string;
  diagnostics: CanvasDiagnostic[];
  manifest?: CanvasArtifactManifest;
}
```

The canvas points separately to `currentSourceVersionId` and
`publishedBuildId`. A failed build records diagnostics but never replaces the
last-known-good artifact.

The artifact manifest records entry HTML, emitted assets, content hashes,
dependency versions, canvas SDK version, and declared PostHog resources. It is
not a general permission model yet, but it must be extensible for one.

## End-to-end flow

1. A user starts from a canvas or asks any task to create/update one.
2. The agent invokes the canvas-authoring skill and resolves or creates a target
   canvas through explicit tools.
3. The agent reads the source project and its current source-version ID.
4. It edits the source files in its task workspace and runs the canvas build
   validation tool as often as needed.
5. The build service installs only allowed, pinned browser dependencies in an
   isolated environment, bundles the project, and returns structured diagnostics.
6. The agent previews or smoke-tests the candidate artifact and repairs errors.
7. The agent publishes the complete source project with
   `expected_current_version_id`.
8. PostHog atomically appends the source version and creates a build. A stale
   base returns `409 version_conflict`; it never silently overwrites newer work.
9. When the build becomes ready, PostHog advances `publishedBuildId` and emits a
   canvas/task update. On failure, the previous build remains live.
10. The app loads the immutable artifact in the existing null-origin sandbox and
    brokers PostHog data, capture, navigation, and safe external-open requests.

## Build pipeline

### Build API

The build boundary accepts source, not arbitrary shell commands:

```ts
buildCanvas({
  canvasId,
  sourceVersionId,
  project,
  mode: "validate" | "publish",
})
```

The service owns one build recipe rooted at `index.html`; agents cannot supply a
build command. The recipe handles JavaScript, TypeScript, JSX/TSX, CSS, static
assets, and dependencies. This keeps the pipeline deterministic while allowing
arbitrary browser output.

### Build stages

1. Validate the source-project schema, paths, file count, and total size.
2. Resolve exact dependency versions against an allow/policy layer.
3. Bundle with esbuild or Vite in an isolated worker with no project credentials.
4. Generate a strict CSP and reject unsupported dynamic egress patterns.
5. Scan emitted assets for size, source maps, and forbidden URL schemes.
6. Load the artifact in a headless version of the canvas sandbox.
7. Require a successful first render and collect console/runtime diagnostics.
8. Extract the declared insight/query references into the artifact manifest.
9. In publish mode, upload content-addressed assets and return their integrity
   hashes. In validate mode, retain artifacts only for a short-lived preview.

Build workers have bounded CPU, memory, time, output size, and dependency count.
Package installation has network access only to the configured registry/cache;
the build itself runs without network access. Package lifecycle scripts are
disabled initially.

### Runtime

The artifact is served from a dedicated user-content origin and loaded with the
existing `sandbox="allow-scripts"` boundary. Runtime Babel, browser Tailwind JIT,
and esm.sh imports disappear for built canvases. The artifact may contain any
browser-safe HTML/CSS/JavaScript produced by the build.

The `ph` canvas SDK remains transport-independent and is injected by the host.
It continues to broker data and side effects over `postMessage`; private
credentials never enter the artifact. Existing methods remain compatible while
the SDK gains version negotiation through the artifact manifest.

## Skills available to every task

Canvas behavior should be represented by bundled skills rather than a canvas-
specific mega-prompt. Split the current prompt contract into focused skills:

- `building-canvases` — routes intent, chooses suitable implementation patterns,
  and explains the source-project and iteration workflow.
- `building-react-quill-canvases` — React, Quill, theming, accessibility, and
  canvas SDK patterns.
- `building-html-canvases` — semantic HTML, CSS, browser APIs, canvas/WebGL, and
  optional client libraries.
- `querying-canvas-data` — creates/reuses PostHog insights and uses the canvas
  data SDK correctly.
- `validating-and-publishing-canvases` — build diagnostics, preview, guarded
  publish, and conflict recovery.

These ship through the existing bundled PostHog skills distribution and are
installed for Claude and Codex like other bundled skills. They are discoverable
in every task and can be explicitly invoked with slash commands or skill tags.

Canvas creation must not depend on the model spontaneously guessing a hidden
tool sequence. Add concise canvas tools that any task can call:

- list/get/create canvas
- get source project and current version
- validate candidate source project
- publish candidate source project with an expected version
- read build status and diagnostics

Starting from the canvas UI preselects the target canvas and invokes
`building-canvases`; it does not use a separate system prompt or agent runtime.
Starting from an ordinary task requires the agent to resolve/create the target
and receive normal tool approval. Skill availability grants knowledge, not
write authority: publishing still requires project scope and the explicit
canvas write tool.

Cloud runs must receive the same bundled skill versions as local runs. Add an
integration test that starts a generic cloud task, invokes the canvas skill,
validates a project, and publishes it without using the canvas composer.

## Architecture ownership

### `posthog/code`

- `@posthog/shared`: source-project, build, manifest, diagnostic, and protocol
  schemas with no I/O.
- `@posthog/core`: canvas generation orchestration, source/build decisions,
  conflict handling, and an injectable `CanvasApplicationService`.
- `@posthog/ui`: source/build status, preview, and the thin iframe host. Hooks
  wrap one service operation or state selector; there is no framework picker.
- `@posthog/workspace-server`: local/dev build adapter and preview artifact
  hosting. It implements the same build contract as cloud, rather than owning
  canvas business rules.
- Bundled skill packages: authoring guidance and scripts that call the typed
  canvas tools.

The existing `useGenerateFreeformCanvas` orchestration moves into
`CanvasApplicationService`; the hook becomes a thin mutation adapter.

### `posthog/posthog`

- Django models/API: source versions, build records, optimistic concurrency,
  artifact metadata, and task/canvas attribution.
- Build workers: isolated dependency resolution, compilation, validation,
  preview, and artifact upload.
- MCP: typed canvas source/build/publish tools available to any authorized task.
- Object storage/CDN: immutable, content-addressed browser artifacts on the
  user-content origin.
- Task runtime: bundles the canvas skills into ordinary cloud tasks and forwards
  task identity on canvas writes.

## Migration and compatibility

- Treat existing `meta.code` canvases as a synthetic web project whose entry
  mounts the stored default React component.
- Continue rendering them through the current runtime path until their first
  successful build.
- The first edit/build creates a source version and built artifact; retain legacy
  code and history during the rollout for rollback.
- New clients prefer `publishedBuildId` but fall back to legacy `meta.code`.
- Roll out reads before writes, then make built artifacts the default for new
  canvases, and remove runtime compilation only after old supported clients age
  out.

## Delivery phases

### Phase 1 — Contracts and skills

- Define source-project, build, diagnostic, and manifest schemas.
- Extract the current authoring contract into the five bundled canvas skills.
- Expose read/create/validate/publish tools to ordinary local and cloud tasks.
- Keep the existing single-file publish endpoint underneath the compatibility
  adapter so this phase can ship before the build service.
- Move generation orchestration from the UI hook into core.

Exit criterion: a generic task can intentionally create or edit today's React
canvas using bundled skills and guarded publishing.

### Phase 2 — Deterministic local build and preview

- Add the neutral web-project starter with platform-supported React, Quill, and
  canvas SDK dependencies.
- Implement the shared build contract in workspace-server for development and
  local-agent validation.
- Bundle dependencies, remove browser Babel/Tailwind from candidate previews,
  run a headless smoke test, and return structured diagnostics.
- Render preview artifacts through the existing iframe host.

Exit criterion: the same starter contract produces a React + Quill data canvas,
a semantic HTML document, and a Three.js experience without runtime compilation
or CDN imports.

### Phase 3 — Cloud builds and immutable artifacts

- Add source/build persistence and guarded publish APIs in `posthog/posthog`.
- Run isolated cloud builds and upload content-addressed artifacts.
- Advance the live build only after validation succeeds; preserve the last-good
  build on failure.
- Add polling/subscription and diagnostics UI in `code`.

Exit criterion: canvas generation continues after the initiating client closes,
and every live canvas references a reproducible immutable build.

### Phase 4 — Package and runtime expansion

- Replace the fixed runtime whitelist with package policy: pinned versions,
  risk/size checks, cached review results, and explicit approval when a build
  expands capabilities.
- Add first-class assets, workers, WebAssembly, WebGL/Three.js test coverage,
  and dependency/update UX.
- Add source editing and diff-aware agent edits without weakening guarded
  publishing.

Exit criterion: arbitrary client-only browser applications are supported within
documented resource and security limits.

## Testing and observability

- Schema compatibility and migration tests for legacy canvas metadata.
- Parameterized fixture builds for React/Quill, plain HTML, TypeScript, Three.js,
  bad imports, lifecycle scripts, oversized output, infinite build, and runtime
  failure.
- Red/green tests for concurrency: two agents edit the same base; the second
  publish receives a conflict and leaves the first build untouched.
- Contract tests run the same fixtures through local and cloud build adapters.
- End-to-end tests create canvases from both the canvas UI and a generic task.
- Security tests cover iframe isolation, CSP, credential absence, package
  scripts, path traversal, artifact integrity, and task/project authorization.
- Record build queue time, build duration, cache hit rate, artifact size,
  diagnostic category, first-render success, and rollback rate.

## Future direction: hosted micro-apps

The manifest and artifact model should later admit a `fullstack` deployment with
hosted serverless functions, scoped secrets, storage, scheduled jobs, and
outbound-network permissions. That work requires a separate threat model,
capability/approval UX, quotas, billing, logs, tracing, and lifecycle ownership.

Do not encode backend assumptions into the browser build pipeline now. The
useful compatibility point is that a future deployment can reference the same
immutable frontend artifact and add separately versioned backend resources.

## Decisions and open questions

Decided:

- Preserve arbitrary code; do not replace it with a dashboard/component schema.
- There is one browser-application source model and one build recipe. The agent,
  not the user or persisted canvas type, chooses React, Quill, plain HTML, or a
  mixture based on the requested experience.
- Build commands are selected by the platform, not supplied by generated code.
- Skills are available to every task; canvas mode only supplies target context.
- Failed builds never replace the last-known-good artifact.
- Publishing uses mandatory optimistic concurrency.

Open before Phase 3:

1. Whether source projects remain in `desktop_file_system.meta` initially or
   move immediately to normalized source-version tables.
2. Which package registry and review policy back dependency resolution.
3. Whether cloud is the only authoritative publisher or local builds may upload
   an artifact that cloud independently verifies.
4. Artifact retention, maximum source/build size, and per-project build quotas.
5. How source and build versions appear in task threads and canvas history.
6. Which data calls must be declared statically versus learned during validation.
