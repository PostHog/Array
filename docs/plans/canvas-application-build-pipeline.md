# Canvas Application Build Pipeline — Implementation Plan

> Status: initial implementation
> Scope: evolve single-file, runtime-compiled React canvases into built browser
> applications. Support React, Quill, and generic HTML in one application model;
> hosted backends and full micro-apps are outside the initial scope.

## Summary

A canvas is an arbitrary client-side browser application. Its source is a small
web project that may use React, Quill, plain DOM APIs, WebGL, or any combination.
A build service compiles the project into an immutable HTML/CSS/JavaScript
artifact that runs in the sandboxed canvas host.

HTML is the common deployment format. Framework selection remains an
implementation detail rather than a product mode: React supplies a component
model for stateful interfaces, Quill supplies accessible PostHog UI primitives,
and direct browser APIs avoid unnecessary framework structure for documents,
graphics, and focused experiments. One source-project contract and one build
recipe support all of these approaches.

Canvas authoring is a reusable agent capability. Bundled skills teach every task
how to create, build, validate, and publish canvases. Canvas-initiated tasks use
the same capability with a preselected target; tasks started elsewhere can
resolve or create a target through the canvas tools.

## Current state

A canvas is currently a `dashboard` entry in PostHog's desktop file system. Its
`meta.code` field contains one agent-authored React/TSX file, and `meta.versions`
contains full-file history. The canvas composer starts a repository-less cloud
task with a large embedded authoring contract. The task explores PostHog data,
creates insights, and publishes complete source through the
`desktop-file-system-canvas-partial-update` MCP tool.

The client sends the stored source to a null-origin iframe. The iframe downloads
Babel, Tailwind, and allowlisted modules, compiles the source in the browser,
and mounts its default React export. PostHog data and side effects cross a
schema-validated `postMessage` bridge so private project credentials remain in
the host.

This design proves the authoring and sandbox model, but the single-file React
contract, runtime compilation, CDN dependencies, canvas-specific prompt, and
late runtime validation limit reliability and the range of applications that
can be produced. The proposed pipeline retains the sandbox and data bridge while
replacing source storage, agent guidance, validation, and deployment.

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
  including that runtime in this project.

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

There is one canvas kind: a browser application. Framework selection is not
persisted as a mode and does not require a canvas-specific creation screen.

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
of them as the same web project and produces the same artifact contract.
Framework selection requires clarification only when it changes a user-visible
requirement that cannot be inferred from the request.

### Canvas source project

Replace `meta.code` as the canonical write format with a small source project:

```ts
interface CanvasSourceProject {
  schemaVersion: 1;
  files: Record<string, string>;
  entryHtml: "index.html";
  dependencies: Record<string, string>;
  canvasSdkVersion: string;
  capabilities: CanvasCapabilities;
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
  taskId: string;
  taskRunId: string;
  sourceHash: string;
  sourceObjectKey: string;
  sourceSize: number;
  prompt?: string;
  createdAt: number;
}

interface CanvasBuild {
  id: string;
  sourceVersionId: string;
  status: "queued" | "building" | "ready" | "failed";
  artifactObjectPrefix?: string;
  integrity?: string;
  diagnostics: CanvasDiagnostic[];
  manifest?: CanvasArtifactManifest;
}
```

The canvas points separately to `currentSourceVersionId` and `activeBuildId`. A
failed build records diagnostics but never replaces the
last-known-good artifact.

The artifact manifest records entry HTML, emitted assets, content hashes,
dependency versions, canvas SDK version, and the validated capability manifest.

The source-project schema is the API and agent-workspace representation. A
source version stores a pointer to its serialized project rather than embedding
the project in the database record.

### Run and history model

Each canvas generation or edit attempt executes as a fresh `TaskRun`. A run may
publish at most one source version to a canvas. A task may group related
conversation, but a later edit does not reuse the run that produced an earlier
version. Tasks initiated outside the canvas use the same rule: the active run is
attributed to its publish, and a subsequent requested edit starts another run.

Several tasks and runs may edit the same canvas concurrently. Every run records
the source version it read, and guarded publishing rejects a run whose base is
no longer current. Conflict recovery starts another run against the new head;
it does not mutate the provenance of either completed attempt.

The canvas history is canonical. Each entry combines the source version and its
builds and shows prompt summary, author, task/run attribution, timestamps,
build status, diagnostics, active/pinned state, and preview/restore/rebuild
actions. The task thread receives compact system updates that link to the canvas
history entry. It does not duplicate source or full build diagnostics. This
model supports one canvas edited by many runs without making any single task the
owner of its history.

## Storage architecture

The relational database stores control-plane state; object storage stores
content. Neither multi-file source projects nor compiled HTML/JavaScript/CSS
artifacts belong in `desktop_file_system.meta` or another database JSON column.

### Database

Database records contain:

- canvas identity, channel/project ownership, title, and permissions;
- current source-version and active-build pointers;
- immutable source-version metadata: parent, content hash, object key, byte
  size, author/task attribution, prompt summary, and timestamps;
- build lifecycle metadata: source version, status, artifact prefix, integrity,
  bounded diagnostics, dependency/SDK versions, and timestamps;
- the bounded artifact manifest and declared PostHog resource references.

This state needs relational constraints, transactions, authorization filters,
and efficient list queries. Large text blobs and emitted assets provide none of
those benefits and would increase database storage, replication, backup, and
query costs.

The existing desktop file-system row remains the canvas's navigation identity
during migration. Its metadata holds only compatibility fields and pointers;
normalized source-version and build tables own the new lifecycle.

### Private source objects

Each source project is serialized deterministically as a compressed archive,
hashed, and uploaded under an immutable project-scoped key. Source objects are
private, encrypted at rest, and downloadable only through an authenticated API
after project and canvas authorization. They may contain proprietary logic,
internal names, or other material that must not be exposed by the user-content
runtime.

Content addressing deduplicates identical versions within a project and makes
the database hash verifiable. Deduplication must not cross project or tenant
boundaries because shared object identity can leak whether another tenant has
the same source.

### Built artifact objects

Build output is uploaded as immutable files under a build
prefix: entry HTML, JavaScript and CSS chunks, images, fonts, source-map policy
metadata, and the artifact manifest. These objects are served from the dedicated
user-content origin with immutable cache headers and integrity metadata.

An artifact is private by default. The canvas host obtains short-lived access or
loads it through an authorized artifact endpoint. A future sharing feature may
grant a separate share capability; an unguessable object key alone is not an
authorization mechanism. Source archives are never served from the
user-content origin.

### Atomic publish and build activation

Publishing uses an upload-then-commit protocol:

1. Serialize and hash the complete source project.
2. Upload the immutable source object. Reusing an existing project-scoped hash
   is safe and idempotent.
3. In a database transaction, lock the canvas, compare
   `expected_current_version_id`, insert the source version and queued build,
   and advance the current source pointer.
4. If the transaction conflicts or fails, leave the uploaded object unreferenced
   for garbage collection; never partially publish a database version.
5. The build worker reads the source by object key, validates and builds it, then
   uploads immutable artifact objects.
6. In a second transaction, mark the build ready and advance the active-build
   pointer only if the build is still eligible for that canvas. A stale or failed
   build cannot replace a newer or last-known-good artifact.

Object storage does not participate in database transactions, so immutable
uploads before pointer changes and idempotent workers are required. A periodic
collector deletes unreferenced source uploads, failed/expired preview artifacts,
and superseded builds after a recovery grace period. Retention policy may keep
referenced historical source and builds for undo, audit, and rollback.

Full build logs and large diagnostic payloads belong in log/object storage with
a bounded summary in the database.

### Retention

Source and build retention have different policies:

- Retain every referenced source version for the lifetime of the canvas so
  history, attribution, undo, and deterministic rebuild remain available.
- Retain the active and immediately previous successful build for instant
  rollback.
- Retain explicitly pinned builds for the lifetime of the canvas.
- Retain other successful builds for 30 days, then delete their artifacts. They
  remain rebuildable from the source archive, dependency lock, and versioned
  build image.
- Retain failed and preview artifacts for 24 hours for diagnosis, then delete
  them.
- Apply the product's standard log-retention policy to full build logs.

Project storage and build quotas still require sizing from production data, but
quota enforcement must not delete referenced source history or the active and
rollback builds. Canvas/project deletion schedules all associated objects for
deletion after the recovery grace period.

## End-to-end flow

1. A user starts from a canvas or asks any task to create/update one, producing
   a fresh run for this attempt.
2. The agent invokes the canvas-authoring skill and resolves or creates a target
   canvas through explicit tools.
3. The agent reads the source project and its current source-version ID.
4. It edits the source files in its task workspace and runs the canvas build
   validation tool as often as needed.
5. The build service resolves only pre-admitted, pinned browser dependencies,
   bundles the project in a bounded subprocess without executing canvas source,
   and returns structured diagnostics.
6. The agent previews or smoke-tests the candidate artifact and repairs errors.
7. The agent publishes the complete source project with
   `expected_current_version_id`.
8. PostHog atomically appends the source version and creates a build. A stale
   base returns `409 version_conflict`; it never silently overwrites newer work.
9. When the build becomes ready, PostHog advances `activeBuildId` and emits a
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

1. Validate the source-project schema, paths, file count, dependency count, and
   total size.
2. Resolve exact versions from the pre-admitted dependency set.
3. Bundle with esbuild in a bounded subprocess with no project credentials and
   without executing canvas source.
4. Generate a strict CSP, reject inline and remote executable scripts, and keep
   direct external egress disabled until capability approval exists.
5. Independently verify emitted paths, sizes, hashes, content types, source-map
   policy, and manifest completeness in the cloud worker.
6. Freeze the statically validated capabilities into the artifact manifest.
7. In publish mode, upload immutable assets and return their integrity hashes.
   Validation mode returns diagnostics and the manifest without retaining or
   returning executable artifacts.

Build workers have bounded CPU, memory, time, output size, and dependency count.
Package installation has network access only to the configured registry/cache;
the build itself runs without network access. Package lifecycle scripts are
disabled.

### Capability manifest and data validation

Each source project declares the PostHog capabilities its artifact requires. The
manifest shape reserves network origins for a later approval flow; the initial
implementation requires that list to remain empty:

```ts
interface CanvasCapabilities {
  posthog: {
    insights: string[];
    inlineQueries: boolean;
    captureEvents: string[];
  };
  network: {
    origins: string[];
  };
}
```

Validation combines two sources of evidence:

1. The explicit declaration produced with the source project.
2. Static extraction of recognizable `ph.loadInsight`, `ph.query`,
   `ph.capture`, and network references from source and emitted code.
Extracted behavior that is not declared fails the build. Declared capabilities
that static analysis cannot observe remain valid because not every interaction
branch is statically recognizable. Dynamic PostHog queries use the explicit
inline-query capability. Direct network access fails closed until capability
expansion can be surfaced for user approval.

The host data bridge and artifact CSP enforce the validated manifest at runtime.
A canvas cannot call an undeclared insight, execute an inline query without that
capability, capture an undeclared event, or connect to an undeclared origin. The
same manifest is used for authenticated canvas views and future shared views;
the viewer's authorization may further reduce the allowed operations but never
expand the artifact's declaration.

### Dependency policy

The initial build image contains a deliberately small pre-admitted set of exact
package versions: React, React DOM, Quill, and Three.js. Undeclared packages and
other versions fail validation, and package lifecycle scripts are disabled.

A later package-expansion phase can admit more exact npm versions through a
guarded process before they enter the build cache:

- vulnerability, provenance, package-age, license, and suspicious-file checks;
- compressed, installed, and browser-bundle size limits;
- rejection of native binaries and unsupported build-time behavior;
- lifecycle scripts disabled during installation;
- isolated builds without PostHog, project, or customer credentials;
- an explicit approval when a dependency expands runtime capabilities, such as
  access to a new external network origin.

Admission decisions are cached by exact package version and policy version.
Previously admitted versions do not bypass a newer policy or security block.
Platform-supported dependencies and the canvas SDK use the same pinned resolver.

### Build authority

Cloud builds are authoritative for publication. Desktop and web may run the
same versioned build contract locally for fast validation and preview, but they
publish source projects, not executable artifacts. The cloud resolves the
locked dependencies, rebuilds the source in the canonical isolated environment,
and uploads the only artifact that can become the canvas's active build.

This boundary avoids trusting client-produced JavaScript and gives every live
canvas one compiler, resolver, SDK, package policy, and audit path. Local and
cloud adapters run shared contract fixtures to catch toolchain drift before a
publish produces different diagnostics.

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

Canvas behavior is represented by bundled skills instead of a canvas-specific
mega-prompt. The current prompt contract is split into focused skills:

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
- validate candidate source project with the authoritative cloud recipe
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
  object pointers, artifact metadata, and task/canvas attribution.
- Build workers: isolated dependency resolution, compilation, validation,
  preview, and artifact upload.
- MCP: typed canvas source/build/publish tools available to any authorized task.
- Object storage/CDN: immutable, content-addressed browser artifacts on the
  user-content origin plus private source archives in a separate namespace.
- Task runtime: bundles the canvas skills into ordinary cloud tasks and forwards
  task identity on canvas writes.

## Migration and compatibility

- Treat existing `meta.code` canvases as a synthetic web project whose entry
  mounts the stored default React component.
- Continue rendering them through the current runtime path until their first
  successful build.
- The first edit/build creates a source version and built artifact; retain legacy
  code and history during the rollout for rollback.
- New clients prefer `activeBuildId` but fall back to legacy `meta.code`.
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

Exit criterion: a generic task can intentionally create or edit a legacy
single-file React canvas using bundled skills and guarded publishing.

### Phase 2 — Deterministic local build and preview

- Add the neutral web-project starter with platform-supported React, Quill, and
  canvas SDK dependencies.
- Implement the shared build contract in workspace-server for development and
  local-agent validation.
- Implement guarded npm admission and the pinned dependency resolver used by
  both local previews and cloud builds.
- Bundle dependencies, remove browser Babel/Tailwind from candidate previews,
  and return structured compile and policy diagnostics.
- Render preview artifacts through the existing iframe host.

Exit criterion: the same starter contract produces a React + Quill data canvas,
a semantic HTML document, and a Three.js experience without runtime compilation
or CDN imports.

### Phase 3 — Cloud builds and immutable artifacts

- Add source/build persistence, validation, and guarded publish APIs in
  `posthog/posthog`.
- Run isolated cloud builds and upload content-addressed artifacts.
- Advance the live build only after validation succeeds; preserve the last-good
  build on failure.
- Add polling/subscription and diagnostics UI in `code`.

Exit criterion: canvas generation continues after the initiating client closes,
and every live canvas references a reproducible immutable build.

### Phase 4 — Package and runtime expansion

- Expand package-policy coverage and dependency/update UX using observed build
  requests and admission failures.
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
- History tests verify that each edit has distinct task-run attribution and that
  thread updates link to the canonical canvas version.
- Contract tests run the same fixtures through local and cloud build adapters.
- End-to-end tests create canvases from both the canvas UI and a generic task.
- Security tests cover iframe isolation, CSP, credential absence, package
  scripts, path traversal, artifact integrity, task/project authorization, and
  rejection of undeclared data/network capabilities.
- Record build queue time, build duration, cache hit rate, artifact size,
  diagnostic category, first-render success, and rollback rate.

## Future extension: hosted micro-apps

The manifest and artifact model should later admit a `fullstack` deployment with
hosted serverless functions, scoped secrets, storage, scheduled jobs, and
outbound-network permissions. That work requires a separate threat model,
capability/approval UX, quotas, billing, logs, tracing, and lifecycle ownership.

Backend execution is a separate deployment concern and does not change the
browser build contract. A future deployment can reference the same immutable
frontend artifact and add separately versioned backend resources.

## Architecture decisions

- Preserve arbitrary code; do not replace it with a dashboard/component schema.
- There is one browser-application source model and one build recipe. The agent
  selects React, Quill, plain HTML, or a mixture based on the requested
  experience; the selection is not a persisted canvas type.
- Build commands are selected by the platform, not supplied by generated code.
- Skills are available to every task; canvas mode only supplies target context.
- Failed builds never replace the last-known-good artifact.
- Publishing uses mandatory optimistic concurrency.
- The database stores canvas lifecycle metadata and object pointers. Private
  source archives and built artifacts are immutable object-storage content with
  separate access policies.
- npm dependencies use guarded admission, exact versions, disabled lifecycle
  scripts, isolated builds, and approval for expanded runtime capabilities.
- Local builds provide validation and previews; canonical cloud rebuilds produce
  the only artifacts eligible for publication.
- All referenced source versions are retained. Compiled artifacts are bounded
  to active, rollback, pinned, and recent builds according to the retention
  policy.
- Every canvas generation or edit has a distinct run and source-version
  attribution. Canvas history is canonical; task threads link to it with compact
  updates.
- Data and network access use a declared capability manifest checked through
  static extraction and smoke-test observation, then enforced at runtime.
