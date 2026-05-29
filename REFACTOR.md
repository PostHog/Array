# REFACTOR.md - VS Code-style migration guide

This file is the procedure for moving `apps/code` toward a VS Code-like architecture:
small host entrypoints, package-owned services, constructor injection, feature
contributions, and host-specific service implementations registered at startup.

Read [AGENTS.md](./AGENTS.md) for the layering rules. This guide explains how to
apply those rules during the package migration.

[MIGRATION.md](./MIGRATION.md) is the running log of what landed, what still
bridges old code, and what unblocks each bridge's removal.

For long-running or parallel agent work, use the coordination files described in
[Agent Harness](#agent-harness). They are the source of truth for what is
claimed, what is passing, and what the next agent should do.

---

## Target Shape

Runtime code moves out of `apps/code` into packages. `apps/code` becomes the
Electron host: process startup, windows, lifecycle, Electron adapters, and
registration of desktop-specific services.

```
packages/
├── platform/            # service identifiers + host capability interfaces
├── core/                # host-agnostic business services and orchestration
├── ui/                  # React DOM workbench, feature views, UI services
├── workspace-server/    # Node-only host syscall services and tRPC server
├── workspace-client/    # typed client for workspace-server
├── api-client/          # PostHog/Django HTTP client
└── shared/              # zero-dep primitives, types, utilities

apps/
├── code/                # current Electron desktop host
├── web/                 # future web host
└── mobile/              # React Native host; imports core/platform/shared
```

Real package paths live under `src/`:

```
packages/core/src/sessions/
├── sessions.ts
├── sessions.module.ts
├── schemas.ts
└── sessions.test.ts

packages/ui/src/features/sessions/
├── SessionsView.tsx
├── sessions.contribution.ts
├── sessions.module.ts
├── store.ts
└── useSessions.ts

packages/workspace-server/src/services/git/
├── git.ts
├── git.module.ts
├── schemas.ts
└── git.test.ts

apps/code/src/renderer/
├── desktop-services.ts
├── desktop-contributions.ts
└── main.tsx
```

Use the bare layer names below (`core`, `ui`, `workspace-server`) as shorthand
for those package paths.

---

## Architecture Model

The model is VS Code-style, implemented with InversifyJS:

- Packages define service identifiers, interfaces, implementations, and
  registration modules.
- Host apps load package modules and bind host-specific implementations.
- Consumers receive dependencies through constructors.
- Feature startup happens through workbench contributions.
- `container.get(...)` is allowed only at startup boundaries, tests, and
  framework adapters. It is not allowed inside service methods or components as a
  service locator.

There is no mega composition root that manually constructs every feature. The
desktop entrypoint should import registration modules and start the workbench.

```ts
// apps/code/src/renderer/main.tsx
import "./desktop-services";
import "./desktop-contributions";

await startWorkbench();
```

```ts
// apps/code/src/renderer/desktop-services.ts
import { container } from "@renderer/di/container";
import { NOTIFICATIONS_SERVICE } from "@posthog/platform/notifications";
import { TrpcNotificationsService } from "@renderer/platform-adapters/notifications";

container
  .bind(NOTIFICATIONS_SERVICE)
  .to(TrpcNotificationsService)
  .inSingletonScope();
```

```ts
// apps/code/src/renderer/desktop-contributions.ts
import { container } from "@renderer/di/container";
import { sessionsUiModule } from "@posthog/ui/features/sessions/sessions.module";
import { notificationsUiModule } from "@posthog/ui/features/notifications/notifications.module";

container.load(sessionsUiModule, notificationsUiModule);
```

The entrypoint chooses the runtime. Packages own the feature wiring.

---

## Agent Harness

This migration is worked by many agents running concurrently in the **same
single working tree** across many context windows. Agents never stop after one
slice and never hand off: each agent claims a slice, ports it, then immediately
claims the next, and keeps going until it runs out of context. Treat the repo
as a shared live workspace that any agent can arrive cold to, understand from
the coordination files, and continue from.

**Non-negotiable working rules for every agent:**

- **Never stop.** Finishing a slice is not a stopping point. The instant a slice
  is validated, claim the next highest-priority `todo` and continue. Only stop
  when out of context.
- **Never commit.** Do not run `git commit`, `git add` for a commit, or create
  branches. All work stays as uncommitted edits in the shared working tree. The
  coordination files below are the synchronization mechanism, not git history.
- **Never use git worktrees.** Every agent works in the one main working tree.
  Do not create, switch to, or prefer separate worktrees or branches.
- **Collaborate, don't isolate.** Other agents are editing the same files at the
  same time. Conflict risk is never a reason to stop or to avoid a slice. Make
  your edits, keep the tree typechecking, and keep moving.

Set up three coordination artifacts before broad parallel work starts:

- `REFACTOR_SLICES.json` - structured inventory of migration slices and their
  acceptance checks.
- `REFACTOR_PROGRESS.md` - append-only notes of what each agent changed,
  validated, deferred, or broke.
- `scripts/refactor-init.sh` - one command that installs/starts/checks enough of
  the app for a fresh agent to verify the baseline before doing new work.

The JSON file is the anti-premature-victory device. Every slice starts as not
passing. Agents may claim a slice and later mark it passing only after the
acceptance checks and smoke test have actually run.

Example slice:

```json
{
  "id": "notifications-renderer-platform",
  "category": "renderer-platform-capability",
  "priority": 40,
  "status": "todo",
  "claimedBy": null,
  "paths": [
    "apps/code/src/main/services/notification",
    "apps/code/src/renderer/features/notifications",
    "packages/platform/src/notifications.ts",
    "packages/ui/src/features/notifications"
  ],
  "data": {
    "model": "TaskNotification",
    "sourceOfTruth": "TaskNotificationService decision inputs",
    "derivedProjections": ["display title", "body text", "attention intent"]
  },
  "acceptance": [
    "platform interface contains no Electron/macOS/Windows-specific terms",
    "app adapter is a dumb tRPC/Electron wrapper",
    "notification gating lives in package service",
    "feature smoke test sends a prompt-complete notification"
  ],
  "passes": false
}
```

Use these statuses:

- `todo` - unclaimed.
- `in_progress` - one agent owns it right now.
- `blocked` - cannot proceed without a named dependency or decision.
- `needs_validation` - code moved, but smoke test is not complete.
- `passing` - acceptance checks are verified and `passes` is true.

Agents may update `status`, `claimedBy`, `notes`, validation evidence, and
`passes`. They must not delete slices or weaken acceptance criteria to make a
slice pass. If the criteria are wrong, add a note and get the criteria corrected
explicitly.

### Agent Startup Protocol

Every agent session starts the same way:

1. Run `pwd`.
2. Read `REFACTOR.md`, `MIGRATION.md`, `REFACTOR_PROGRESS.md`, and
   `REFACTOR_SLICES.json`.
3. Read recent git history: `git log --oneline -20`.
4. Check the worktree: `git status --short`.
5. Run `scripts/refactor-init.sh` if it exists.
6. Verify the baseline smoke test before implementing a new slice. If the
   baseline is broken, fix or record that first; do not pile a new migration on
   top of an unknown failure.
7. Claim exactly one `todo` slice by setting it to `in_progress` with your
   agent/session id.

### Per-Slice Wrap-Up (then immediately continue)

When a slice's code is done, do this and then **claim the next slice without
stopping** — this is a loop, not the end of a session:

1. Run focused tests/typecheck for the slice.
2. Run the relevant smoke test as a user would, not just a unit-level substitute.
3. Run `pnpm biome format --write .` and `pnpm typecheck` so the shared tree
   stays green for the other agents working in it.
4. Update `REFACTOR_SLICES.json`.
   - Set `passes: true` only when acceptance checks actually passed.
   - Use `needs_validation` if code is done but the feature was not exercised.
   - Use `blocked` with a concrete reason if progress cannot continue.
5. Append a short `REFACTOR_PROGRESS.md` entry: slice id, changed paths,
   validation run, remaining bridges, and next suggested slice.
6. Update `MIGRATION.md` for landed architectural movement.
7. **Do not commit.** Leave everything as uncommitted edits in the shared tree.
8. Re-read `REFACTOR_SLICES.json`, claim the next highest-priority unclaimed
   `todo`, and start again. Keep going until out of context.

### Parallel Work Rules

- Every agent works in the **one shared working tree**. No git worktrees, no
  branches, no commits — see the working rules under [Agent Harness](#agent-harness).
- Claim one slice at a time, but never stop after one. Finish it, then claim the
  next. Foundational/broad slices are fair game when they are the highest-priority
  unclaimed work.
- Parallel edits to the same files (package registration, root DI, the
  coordination files) are expected. Re-read `REFACTOR_SLICES.json` right before
  editing it so you build on the current state instead of clobbering another
  agent's claim. Keep the tree typechecking after your edits.
- Do not mark the whole migration complete because several slices are passing.
  Completion means every slice in `REFACTOR_SLICES.json` is passing or explicitly
  retired with a reason.
- Do not start by making the architecture prettier. Pick the highest-priority
  unclaimed slice and move it through the procedure.
- If a slice reveals a missing prerequisite, create or update a prerequisite
  slice instead of doing untracked background work.

---

## Service Rules

### Data Is Destiny

The data model is the contract that shapes the rest of the system. Treat model
choices as architectural choices, not incidental TypeScript cleanup.

Use these rules when moving or defining data:

- Model the domain object, not the first scalar you happen to need. A
  `Statistic` with `label`, `value`, and `lastUpdatedAt` will evolve better than
  passing `number` through five layers.
- Put runtime boundary shapes in Zod `schemas.ts`, infer TypeScript types from
  those schemas, and make the schema the source of truth for tRPC/API boundaries.
- Store truth once. If two stores, caches, services, or persisted records can
  disagree, name which one owns the truth and make the other a projection.
- Compute derived state. Counts, labels, filtered lists, permission display
  state, and status summaries should be derived from the underlying facts unless
  there is a measured reason to persist them.
- Keep hidden operational fields in the model when they are part of correctness:
  timestamps, version ids, source ids, sync cursors, provenance, and invalidation
  markers often matter even when they never render.
- Do not move a feature by copying its current state shape blindly. During the
  audit, identify the model, the state, the owner of that state, and every
  projection derived from it.

Store truth once, then compute its consequences.

### Service Identifiers

Service identifiers live in the package that owns the contract.

- Host capability contracts live in `packages/platform/src/<capability>.ts`.
- Core domain contracts live in `packages/core/src/<feature>/<feature>.ts`
  when other packages consume them.
- UI-only contracts live in `packages/ui/src/features/<feature>/...` only when
  they do not need to cross package boundaries.

For existing platform capabilities, the interface files in `packages/platform`
are already the right home. The migration is to add package-owned service
identifiers beside those interfaces and gradually stop using app-local
`MAIN_TOKENS.<Capability>` aliases. Do not create new platform identifiers in
`apps/code/src/main/di/tokens.ts`.

Use symbols as Inversify identifiers:

```ts
// packages/platform/src/notifications.ts
export const NOTIFICATIONS_SERVICE = Symbol.for("posthog.notifications");

export interface NotificationsService {
  send(options: NotificationOptions): Promise<void>;
}
```

Avoid global junk-drawer tokens. Prefer narrow feature or capability contracts.
Keep platform interfaces platform-agnostic: model the capability the app needs,
not the implementation detail a host happens to use. For example, expose
`notifyAttentionNeeded()` instead of `bounceDock()`, and let the Electron adapter
decide whether that means a dock bounce, taskbar flash, badge, sound, or no-op.

Main-process migration shape:

```ts
// packages/platform/src/clipboard.ts
export const CLIPBOARD_SERVICE = Symbol.for("posthog.platform.clipboard");

export interface ClipboardService {
  writeText(text: string): Promise<void>;
}
```

```ts
// apps/code/src/main/di/container.ts
container.bind(CLIPBOARD_SERVICE).to(ElectronClipboard);

// Temporary bridge while old consumers still inject MAIN_TOKENS.Clipboard.
container.bind(MAIN_TOKENS.Clipboard).toService(CLIPBOARD_SERVICE);
```

```ts
constructor(
  @inject(CLIPBOARD_SERVICE)
  private readonly clipboard: ClipboardService,
) {}
```

Delete the `MAIN_TOKENS.*` bridge once all consumers inject the package-owned
token.

### Constructor Injection

Services use constructor injection.

```ts
@injectable()
export class TaskNotificationService {
  constructor(
    @inject(NOTIFICATIONS_SERVICE)
    private readonly notifications: NotificationsService,
    @inject(SETTINGS_SERVICE)
    private readonly settings: SettingsService,
  ) {}

  async notifyPromptComplete(task: TaskSummary): Promise<void> {
    const settings = await this.settings.getNotificationSettings();
    if (!settings.promptComplete) {
      return;
    }

    await this.notifications.send({
      title: task.title,
      body: "Prompt finished",
    });
  }
}
```

Do not call `container.get(...)` inside service methods. That hides dependencies,
creates runtime ordering bugs, and makes web/mobile hosts impossible to reason
about.

### Registration Modules

Each package feature exports an Inversify `ContainerModule` for its services and
contributions.

```ts
// packages/ui/src/features/notifications/notifications.module.ts
export const notificationsUiModule = new ContainerModule(({ bind }) => {
  bind(TaskNotificationService).toSelf().inSingletonScope();
  bind(WORKBENCH_CONTRIBUTION)
    .to(TaskNotificationContribution)
    .inSingletonScope();
});
```

Modules may bind their own package's services. Host apps bind host-specific
implementations. A package module must never bind Electron implementations.

### Contribution Startup

Use contributions for startup side effects: subscriptions, route registration,
menus, keyboard commands, status items, global UI services, and feature boot.

```ts
export interface WorkbenchContribution {
  start(): void | Promise<void>;
}

export const WORKBENCH_CONTRIBUTION = Symbol.for("posthog.workbenchContribution");
```

At startup, the workbench resolves all `WORKBENCH_CONTRIBUTION` bindings and
starts them.

```ts
export async function startWorkbench(): Promise<void> {
  const contributions = container.getAll<WorkbenchContribution>(
    WORKBENCH_CONTRIBUTION,
  );

  for (const contribution of contributions) {
    await contribution.start();
  }

  renderApp();
}
```

Contributions are the place for "wire once at app boot" behavior. Components do
not start subscriptions ad hoc.

---

## Layer Ownership

### `packages/platform`

Owns host capability interfaces and service identifiers:

- clipboard
- dialog
- notifications
- secure storage
- shell
- file picker
- app lifecycle hooks exposed to shared code
- renderer-consumed host capabilities implemented through tRPC adapters

`platform` imports no internal packages. It is contracts only.

Platform contracts must describe host-neutral capabilities. They should not
mention Electron, DOM, React Native, macOS, Windows, dock, taskbar, tray, or any
other host-specific surface. Those terms belong in adapters. The shared contract
should speak in product intent: notify, open external URL, pick file, write
clipboard text, request attention, store secret.

Existing `apps/code/src/main/platform-adapters/*` classes already implement many
of these contracts. Keep them. The migration is not to rewrite adapters; it is to
bind them to package-owned platform tokens and move consumers off app-local
`MAIN_TOKENS` aliases. Renderer-consumed host capabilities follow the same
pattern with renderer adapters that wrap `trpcClient`.

### `packages/core`

Owns host-agnostic business logic:

- state machines
- orchestration
- retries
- dedup
- batching with business meaning
- parsing and normalization
- typed domain events
- cross-feature business coordination

Core services may depend on `platform`, `workspace-client`, `api-client`,
`shared`, and other core services. They never import `ui`, `workspace-server`,
Electron, or Node host syscalls.

Core may use Inversify decorators and modules, but it must not import an app
container. It exports services and modules; hosts load them.

#### Core Purity Gate

`core` is portable business logic. Do not move code into `packages/core` just
because it is "not UI". If it imports Node, shells out, reads paths from the
host, watches files, checks `process.platform`, reads `process.env`, or depends
on a Node-oriented implementation package, it is not pure core yet.

Before marking a core slice `needs_validation` or `passing`, run:

```sh
pnpm exec biome lint packages/core
pnpm exec biome check packages/core
pnpm --filter @posthog/core typecheck
```

`biome lint packages/core` must have zero `noRestrictedImports` errors. If it
does not, course-correct the placement before continuing:

| Found in proposed core code | Correct move |
|---|---|
| `node:fs`, `node:path`, `node:os`, `node:child_process`, `node:process`, `process.*` | `workspace-server`, or a `platform`/environment contract injected into core |
| `node:crypto` for ids, hashes, PKCE, random bytes | `platform` crypto/random contract, or keep the flow in a host package until a contract exists |
| `node:events` for async iterators/event emitters | use a small shared/platform event abstraction, or keep the event-source owner in `workspace-server` |
| `@posthog/enricher`, git/file scanners, AST scanning tied to repo files | `workspace-server` owns the scan; core may own only the result model and business decision |
| `process.platform` / `process.arch` update logic | app/platform capability supplies host info; core consumes a typed host-info interface |
| Node-only test fixtures in `packages/core` | move the test to the host package or provide a fake pure port; do not weaken the lint rule |

If the business algorithm is valuable but currently mixed with host calls, split
it: put the pure model/decision function in `core`, put host access in
`workspace-server` or an app adapter, and connect them through an injected
interface.

### `packages/workspace-server`

Owns Node-only host syscalls and the tRPC server:

- git CLI
- fs reads/writes
- process spawn
- pty
- watchers
- shell execution
- Node-native capabilities

Workspace-server services are capability-oriented and dumb. They do host work,
source smoothing, validation, and transport. They do not import `core` or `ui`.

### `packages/ui`

Owns React DOM workbench code:

- feature views and components
- TanStack Router route contributions
- command/menu/status contributions
- UI services
- thin Zustand stores for UI state
- hooks wrapping one query/mutation/subscription

UI imports `core`, `platform`, `shared`, and `ui/primitives`. UI never imports
`workspace-server` or app-specific code.

Renderer stores remain thin: UI state, subscription-fed caches, and thin actions.
No business clients, retries, orchestration, cross-store reach-ins, or module
level promise dedup.

### `apps/code`

Owns Electron host code:

- Electron main lifecycle
- window manager
- crash reporter
- updater
- deep links
- single instance lock
- Electron platform adapters
- desktop tRPC adapters
- desktop service registration files

It can import package modules and bind concrete desktop implementations. It
should not contain business logic after migration.

---

## Import Rules

These should become `biome` restricted-import rules.

- `platform` imports nothing internal.
- `shared` imports nothing internal.
- `workspace-server` may import `shared`, `platform` contracts when needed,
  Node modules, and other workspace-server services by direct source path.
- `core` may import `shared`, `platform`, `workspace-client`, `api-client`, and
  other core services by direct source path.
- `ui` may import `core`, `platform`, `shared`, `ui/primitives`, and other public
  UI feature entry files. Avoid importing another feature's internals.
- `apps/code` may import all packages and its own host adapters.

No barrel files. Import direct source files or explicit package export paths.

---

## Naming

- Main implementation file is named after the domain or capability:
  `sessions.ts`, `file-watcher.ts`, `git.ts`.
- Registration file is `<name>.module.ts`.
- Contribution file is `<name>.contribution.ts`.
- Runtime boundary schemas live in `schemas.ts`.
- Type-only exports live in `types.ts`; runtime constants are allowed only when
  deliberately shared.
- Tests colocate as `.test.ts` / `.test.tsx`.

No `service.ts` for new package code unless there is already a strong local
pattern in that folder.

---

## What Moves Where

| Today | New home |
|---|---|
| `apps/code/src/main/services/<X>/service.ts` business orchestration | `packages/core/src/<X>/<X>.ts` |
| `apps/code/src/main/services/<X>/service.ts` host syscalls | `packages/workspace-server/src/services/<cap>/<cap>.ts` |
| Source smoothing for noisy host events | Same workspace-server service that owns the event source |
| `apps/code/src/main/trpc/routers/<X>.ts` | `packages/workspace-server/src/services/<cap>/` one-line router/procedure over service methods |
| `apps/code/src/api/<X>` | `packages/api-client/src/<X>` |
| `apps/code/src/renderer/features/<X>/` | `packages/ui/src/features/<X>/` |
| `apps/code/src/renderer/stores/<X>.ts` thin UI store | `packages/ui/src/features/<X>/store.ts` |
| `apps/code/src/main/platform-adapters/<X>.ts` | stays in `apps/code`; Electron adapter |
| renderer-consumed host capability | `platform` interface + app adapter + package service consuming the interface |

Moving an interface alone is not a port. The implementation moves, or the old
code is clearly marked as a bridge with a retirement condition.

---

## Per-Feature Procedure

Work one feature or capability slice at a time.

1. **Claim one slice.** Pick one `todo` item from `REFACTOR_SLICES.json`, set it
   to `in_progress`, and stay inside that slice's paths unless a prerequisite
   must be recorded.
2. **Audit.** List main services, routers, schemas, renderer stores, components,
   hooks, subscriptions, tests, and fan-in consumers.
3. **Map the data.** Name the model, the source of truth, persisted state,
   in-memory state, subscription-fed caches, and derived projections. If state is
   duplicated, decide which copy owns truth before moving it.
4. **Identify host calls.** Git, fs, spawn, pty, Electron, OS APIs, native
   modules, and watchers move to workspace-server or platform adapters.
   `process.env`, `process.platform`, `node:crypto`, `node:events`, and
   Node-oriented implementation packages count as host calls unless a pure
   browser/mobile-compatible abstraction already exists.
5. **Sort logic.**
   - Host syscall or source smoothing: `workspace-server`.
   - Business orchestration: `core`.
   - UI state/rendering: `ui`.
   - Host capability contract: `platform`.
6. **Create or update service identifiers.** Put cross-package contracts in
   `platform` or the owning package. For existing platform interfaces, add the
   token beside the interface and bind the existing app adapter to it; keep
   `MAIN_TOKENS.*` only as a temporary bridge for old consumers.
7. **Move workspace-server capability first.** Add Zod input/output schemas.
   Routers/procedures remain one-line forwards over service methods.
8. **Move core orchestration if needed.** Use constructor injection. Add a module
   binding the service. Unit test business behavior with mocked deps.
9. **Move UI.** Components, hooks, stores, routes, and contributions move to
   `packages/ui/src/features/<feature>/`. Register UI services/contributions in
   `<feature>.module.ts`. Follow [Porting React UI](#porting-react-ui) for
   component dependencies, route registration, stores, and tests.
10. **Bind host implementations in `apps/code`.** Desktop adapters wrap Electron
   or `trpcClient`. Bind them in desktop registration files.
11. **Bridge only when fan-in requires it.** Keep old app services only as thin
   delegation shims with `// PORT NOTE:` and a retirement condition.
12. **Delete old code when the bridge is gone.**
13. **Update `MIGRATION.md` and `REFACTOR_PROGRESS.md`.**
14. **Validate.** Typecheck, package purity checks, tests, app launch, and a
    real feature smoke test. If the slice touched `packages/core`, run
    `pnpm exec biome lint packages/core` and fix placement until
    `noRestrictedImports` is clean.
15. **Update `REFACTOR_SLICES.json`.** Mark `passing` / `passes: true` only when
    validation and acceptance checks are complete.

---

## Canonical Patterns

### Host Capability Consumed by UI

Notifications are a good example: the UI decides when a task notification should
be shown; the host knows how to show it.

```ts
// packages/platform/src/notifications.ts
export const NOTIFICATIONS_SERVICE = Symbol.for("posthog.notifications");

export interface NotificationsService {
  send(options: NotificationOptions): Promise<void>;
}
```

```ts
// apps/code/src/renderer/platform-adapters/notifications.ts
@injectable()
export class TrpcNotificationsService implements NotificationsService {
  async send(options: NotificationOptions): Promise<void> {
    await trpcClient.notification.send.mutate(options);
  }
}
```

```ts
// packages/ui/src/features/notifications/notifications.ts
@injectable()
export class TaskNotificationService {
  constructor(
    @inject(NOTIFICATIONS_SERVICE)
    private readonly notifications: NotificationsService,
    @inject(SETTINGS_SERVICE)
    private readonly settings: SettingsService,
  ) {}

  async notifyPromptComplete(task: TaskSummary): Promise<void> {
    const settings = await this.settings.getNotificationSettings();
    if (!settings.enabled) {
      return;
    }

    await this.notifications.send({ title: task.title });
  }
}
```

```ts
// packages/ui/src/features/notifications/notifications.module.ts
export const notificationsUiModule = new ContainerModule(({ bind }) => {
  bind(TaskNotificationService).toSelf().inSingletonScope();
});
```

```ts
// apps/code/src/renderer/desktop-services.ts
container
  .bind(NOTIFICATIONS_SERVICE)
  .to(TrpcNotificationsService)
  .inSingletonScope();
```

No package imports `trpcClient`. No app file owns notification business logic.

### Feature Startup Subscription

Subscriptions are contributions, not component side effects.

```ts
@injectable()
export class FileWatcherContribution implements WorkbenchContribution {
  constructor(
    @inject(FILE_WATCHER_SERVICE)
    private readonly watcher: FileWatcherService,
    @inject(FILE_WATCHER_STORE)
    private readonly store: FileWatcherStore,
  ) {}

  start(): void {
    this.watcher.onDidChange((event) => {
      this.store.applyChange(event);
    });
  }
}
```

The contribution is registered once in the feature module. Components render the
store. Components do not subscribe directly.

### Feature With Core Orchestration

Use core when there is real orchestration: Saga, rollback, long-running protocol,
multi-step invariant, or retry/dedup with business meaning.

```ts
// packages/core/src/focus/focus.ts
@injectable()
export class FocusService {
  constructor(
    @inject(GIT_SERVICE)
    private readonly git: GitService,
    @inject(WORKSPACE_SERVICE)
    private readonly workspace: WorkspaceService,
  ) {}

  async enableFocus(input: EnableFocusInput): Promise<EnableFocusResult> {
    // multi-step business orchestration
  }
}
```

```ts
// packages/core/src/focus/focus.module.ts
export const focusCoreModule = new ContainerModule(({ bind }) => {
  bind(FOCUS_SERVICE).to(FocusService).inSingletonScope();
});
```

The UI store calls `FocusService.enableFocus` and updates UI state from the
result. The store does not own the flow.

### React Access to Services

React components may use a small boundary hook to access services from the
renderer container:

```ts
const focus = useService(FOCUS_SERVICE);
```

This hook is for component integration only. Do not use it as a replacement for
constructor injection in services, stores, or contributions.

For hooks wrapping server state, prefer TanStack Query:

```ts
export function useSessions() {
  const sessions = useService(SESSIONS_SERVICE);

  return useQuery({
    queryKey: ["sessions"],
    queryFn: () => sessions.list(),
  });
}
```

Hooks should wrap one query, mutation, or subscription. If a hook coordinates
multiple async sources, move that coordination into a service.

### Porting React UI

Feature UI moves to `packages/ui/src/features/<feature>/`. The app host should
mount and register UI; it should not own feature rendering logic.

Move these together when they belong to the same feature:

- route-level screens,
- child components,
- feature hooks,
- thin feature stores,
- route/menu/command/status contributions,
- colocated tests,
- small feature-local utilities.

Reusable visual building blocks move to `packages/ui/src/primitives/` only when
they are genuinely shared across features. Do not turn a one-feature component
into a primitive just because it moved.

Component rules:

- Components never import `trpcClient`, Electron APIs, `apps/code`, or
  workspace-server code.
- Components use props for local parent-child data flow.
- Components use `useService(TOKEN)` only at React boundaries to access injected
  services.
- Components use feature hooks for server state. A hook wraps one query,
  mutation, or subscription.
- Components use thin Zustand stores only for UI state: selected id, open panel,
  scroll state, draft text, local view mode.
- Components do not start global subscriptions. A contribution starts them once
  and writes to a store/cache.
- Components do not coordinate cross-feature behavior. Put that in a service or
  contribution.

Route registration belongs to the feature module/contribution. Do not keep a
central app-local list of migrated feature routes. The host starts the workbench;
feature modules contribute their routes.

When a component imports old renderer-only paths:

| Old dependency | Migration move |
|---|---|
| `@renderer/trpc/client` or direct `trpcClient` | Wrap in a service/hook backed by `useService` + TanStack Query |
| `@stores/<x>` global store | Move thin UI state to `packages/ui/src/features/<feature>/store.ts`, or expose a temporary service bridge |
| `@renderer/*` utility | Move to `packages/ui` if host-agnostic; keep in app and wrap behind `platform` if host-specific |
| Electron/browser host API | Add or reuse a `platform` service and bind an app adapter |
| another feature's internals | depend on that feature's public service/model, or create a shared model in `core`/`shared` |
| multi-query derived view state | move merge/derivation to a service; hook exposes one query result |

If a component depends on an unported store or utility, do not leave the
component in `apps/code` by default. Either port the dependency in the same
slice, or add a marked bridge with a retirement condition. The dependency
direction is old app code -> new package code, never the reverse.

UI tests should move with the component. Prefer testing the package component
with fake services and explicit props. Use app/Electron tests only for host
adapter behavior or full smoke coverage.

---

## Forbidden Patterns and Fixes

### `container.get(...)` in Service Methods

Wrong:

```ts
async run() {
  const settings = container.get(SETTINGS_SERVICE);
}
```

Fix: inject `SETTINGS_SERVICE` in the constructor.

### Business Logic in Platform Adapters

Adapters translate host calls. They do not decide.

Wrong: notification adapter checks settings, truncates task names, and decides
whether to play a sound.

Fix: UI/core service makes the decision; adapter sends the notification.

Wrong: platform interface exposes `bounceDock()` or `flashTaskbar()`.

Fix: platform interface exposes `requestUserAttention()` or
`notifyAttentionNeeded()`; each host adapter maps that intent to its local
surface.

### Store Owning Multi-Step Flow

Wrong: Zustand action performs OAuth, retries, token refresh, and cross-store
updates.

Fix: service owns the flow. Store action calls one service method and sets UI
state from the returned result.

### Duplicated Truth

Wrong: store persists both `sessions` and `sessionCount`, or separate stores keep
their own writable copies of the same task status.

Fix: one service/store owns the underlying facts. Counts, labels, status text,
filtered lists, and display summaries are computed projections.

### Cross-Store Reach-In

Wrong:

```ts
useOtherStore.getState().clear();
```

Fix: a service or contribution emits/handles a typed event; each feature reacts
through its own registered contribution.

### Store Owning Subscriptions

Wrong: module-level `let subscription`.

Fix: a `WorkbenchContribution` starts the subscription once and writes events to
the store.

### Custom Hook Orchestrating Multiple Queries

Wrong: two `useQuery` calls plus custom merge/retry/state machine.

Fix: expose one service method/procedure returning the merged shape; hook wraps
one query.

### Renderer Service Fetching Domain Data

Move domain fetching/orchestration to `core` or a UI service registered through
Inversify. Renderer services are only for renderer-only mechanics like focus
rings, drag-and-drop, measurement, and visual queues.

### Electron Import in Shared Service Code

Define a platform interface. Implement it in `apps/code`.

---

## Bridges and Coexistence

This codebase is inter-coupled. Use bridges when fan-in makes direct deletion too
expensive.

A bridge may stay in `apps/code` only when it:

- delegates to the new package service,
- holds no business logic,
- preserves an existing API for old consumers,
- has a `// PORT NOTE:` listing remaining consumers and the retirement condition.

Example:

```ts
// PORT NOTE: bridge to @posthog/core/focus. Delete when SessionsService and
// TaskService consume FOCUS_SERVICE directly.
@injectable()
export class FocusServiceBridge {
  constructor(
    @inject(FOCUS_SERVICE)
    private readonly focus: FocusService,
  ) {}

  enableFocus(input: EnableFocusInput) {
    return this.focus.enableFocus(input);
  }
}
```

The dependency direction is old app code -> new package code. New package code
must never import old app modules.

Track every bridge in `MIGRATION.md`.

---

## Validation

For every slice:

- read the slice's acceptance criteria before changing code,
- run the relevant typecheck,
- run package boundary lint before any broad formatter pass,
- run focused tests,
- start the app when user-visible behavior changed,
- smoke test the feature,
- watch logs for one real usage cycle when the change affects background work.

Use these dry-run checks as gates:

```sh
pnpm exec biome lint packages/core
pnpm exec biome check packages/core
pnpm typecheck
```

If a slice touched another package, run the same lint/check command against that
package too. Do not mark a slice `passing` while Biome reports restricted import
violations in a touched package. Use `needs_validation` only for missing runtime
smoke coverage, not for known layer-boundary violations.

Typecheck and tests are necessary but not sufficient. The app must actually run.
Do not set `passes: true` in `REFACTOR_SLICES.json` until the acceptance checks
and smoke test have passed.

---

## Recommended Order

0. Run an initializer pass: create `REFACTOR_SLICES.json`,
   `REFACTOR_PROGRESS.md`, and `scripts/refactor-init.sh`; populate slices from
   the current `apps/code` audit with all `passes` values false.
1. Establish shared DI primitives: service identifiers, contribution token,
   `useService`, and workbench startup that starts contributions.
2. Move read-only data-piping UI features.
3. Move source subscriptions into workspace-server services plus UI
   contributions.
4. Move write paths with Saga/core orchestration.
5. Move renderer-consumed platform capabilities such as notifications, auth, and
   integrations.
6. Move large entangled surfaces last: sessions, terminal, pty.

Keep each slice behavior-preserving unless the migration exposes a forbidden
pattern that must be fixed to make the move valid.

---

## MIGRATION.md Format

Keep entries short and operational:

```md
## 2026-MM-DD - <feature>

- Moved: `<old path>` -> `<new path>`
- Registered: `<module/token/contribution>`
- Data: source of truth is `<owner>`; derived projections are `<list>`
- Cleaned: <layering fix>
- Bridge: `<path>` remains until <consumer/condition>
- Validation: <commands/smoke test>
```

`REFACTOR_PROGRESS.md` is append-only and more tactical:

```md
## 2026-MM-DD HH:MM - <agent/session> - <slice id>

- Changed: `<paths>`
- Validated: `<commands and smoke test>`
- Slice status: `<todo|in_progress|blocked|needs_validation|passing>`
- Next: `<specific follow-up or next slice>`
```
