# PostHog Code Development Guide

This is the single source of truth for how PostHog Code is built. Architecture rules live here. Deep reference docs are linked at the bottom. If something contradicts this file, this file wins.

## Architecture rules (read this first)

Read this section before writing or modifying code. These rules are load-bearing. The goal is a renderer that is strictly UI so the same app shape works on web and mobile, and a main process that owns every byte of business logic but stays host-agnostic so it can later run in a cloud sandbox or a workspace server, not just in Electron. PRs land fast from many contributors and many agents; these rules are what keep the foundation from rotting.

**The principle: three layers, each with one job.**

| Layer                          | One job                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Main process services**      | All business logic and I/O. Orchestration, fetching, polling, parsing, auth, side effects, system telemetry. |
| **Renderer Zustand stores**    | Pure UI state. Subscription-fed caches. Thin action wrappers over tRPC. Nothing else.                        |
| **React components and hooks** | Render the store. Wire user input to store actions or tRPC mutations. Local component state only.            |

**Renderer services are a narrow escape hatch.** Only for renderer-only UI mechanics shared across components (visual queues, drag-and-drop, focus rings). Never for data fetching, never for cross-store coordination on system events, never for multi-step async orchestration.

### Rules in one screen

- **R1** Main services own business logic. `@injectable()`, singleton, exposed via a tRPC router with Zod schemas in the service's `schemas.ts`. No imports from `apps/code/src/renderer/*`.
- **R2** Zustand stores are thin: UI state, subscription caches or queues. Actions do at most one `trpcClient` call plus one state update. No multi-step flows (OAuth dances, token refresh, server sync, retry loops), no module-level `let` promises, no cross-store reach-ins, no business clients, no query-cache surgery, no system-event analytics.
- **R3** Renderer services are a narrow escape hatch. They live in `apps/code/src/renderer/services/`, are `@injectable()`, and never fetch data or coordinate cross-store reactions to system events.
- **R4** Components use `useQuery` and `useMutation`, not imperative `trpcClient` calls. Custom hooks wrap a single query or a store selector. Hooks that orchestrate multiple queries to derive a result become one tRPC procedure.
- **R5** Cross-feature coordination happens in main. Main emits an event; each affected store reacts via its feature's subscription registrar. Stores never reach into other stores.
- **R6** Every tRPC procedure has Zod `input` and (where it returns data) Zod `output`. Types are inferred from schemas, never declared separately.
- **R7** Persistence and platform APIs are main, but main services never import from `electron` directly. Host capabilities (clipboard, dialog, secure storage, file system, shell, notifier, updater) flow through `@posthog/platform` interfaces with per-host adapters in `apps/code/src/main/platform-adapters/`. The renderer persists pure UI prefs via `electronStorage`. Domain data persists in the SQLite DB via a `Repository`.
- **R8** No `container.get(...)` inside service methods. Constructor injection only. A circular dep means the boundary is wrong; split or invert via events.
- **R9** Subscriptions are wired once per feature in `apps/code/src/renderer/features/<feature>/subscriptions.ts`, started at app boot. Components do not start subscriptions ad hoc.
- **R10** tRPC routers are one-liners. No inline business logic. No reaching past the service to a repository. No router without a backing service.
- **R11** Templates use `@posthog/quill` for everything on the rendering layer that's available. Reach for raw primitives or one-off components only when Quill has no equivalent.
- **R12** Routing is TanStack Router. New screens register routes with TanStack Router; do not introduce a second router or hand-rolled routing logic.

### Decision tree

Apply on every new file or meaningful change.

1. Network call, file system, git, shell, multi-step async? Main service.
2. Reusable across hosts (Electron, mobile, web, CI)? Domain package (`packages/*`).
3. Wraps a host capability (clipboard, dialog, secure storage)? Platform adapter behind a `@posthog/platform` interface.
4. Purely about how the UI looks right now? Store if shared, `useState` if local to one subtree.
5. Single user event triggers a single mutation? Component with `useMutation`.
6. Non-trivial renderer-only UI mechanic shared across features? Renderer service.
7. None of the above? Probably a main service.

### Forbidden patterns

These shapes exist in the codebase today. Do not copy them. Do not extend them.

- **Multi-step flows in stores.** Whole auth flows (OAuth dance, token refresh, server-sync), retry loops, polling, anything with `let inFlightAuthSync: Promise | null` style dedup. All of it belongs in a main service. The store just reflects the service's state.
- **Cross-store reach-ins in actions.** `useOtherStore.getState().something()` inside a store action. Main emits an event; each store reacts in its registrar.
- **Business clients held in stores.** `client: createClient(region, projectId)` in a store. Construct in main, store holds a serializable id.
- **Stores owning subscriptions.** `let globalSubscription = trpcClient.X.subscribe(...)` at store module scope. Use a feature subscription registrar.
- **Stores owning timers for domain cleanup.** `window.setTimeout(() => removeClone(id), 3000)`. The host owns the lifecycle and emits a `Removed` event.
- **Custom hooks that orchestrate multiple queries.** Two `useQuery` calls plus a `useMemo` merge. Expose one tRPC procedure that returns the merged shape.
- **Imperative `trpcClient` from components for routine reads.** `useEffect(() => trpcClient.X.query().then(setState))`. Use `useQuery`.
- **tRPC routers bypassing their service to call a repository.** `workspace.ts` does this today; do not extend the pattern.
- **tRPC routers with inline business logic.** Math, time arithmetic, conditional branching inside `.mutation`. Move to a service method.
- **tRPC routers with no backing service.** `os.ts` is 396 lines today with no `OsService`. New routers always have a service.
- **`container.get(X)` inside a service method to dodge a circular dep.** `WorkspaceService` does this with `FileWatcherService`. Split or event-ize instead.
- **Renderer services that fetch domain data or coordinate tRPC.** The 3,796-line `sessions/service/service.ts` is the canonical example. Move it to main.
- **Platform adapters with business logic.** Adapters wrap and translate. Decisions live in services that depend on the adapter via an interface.
- **Importing from `electron` in service code.** Services depend on `@posthog/platform` interfaces, not on `app`, `BrowserWindow`, `clipboard`, `dialog`, `shell`, `safeStorage` etc. Otherwise the service can never run in a cloud sandbox or workspace-server context.

When in doubt, push logic toward main. The renderer is being thinned out, not thickened. Imagine a web or mobile build of this app reusing the same renderer code: every business decision living in a store or component is a thing that won't port.

### Store / service boundary

**Renderer stores own:** pure UI state (open/closed, selected item, scroll position), cached data from subscriptions, message queues and event buffers, permission display state, thin action wrappers that call tRPC mutations.

**Renderer services own (narrow escape hatch only):** renderer-only UI mechanics shared across more than one component (visual action queues, global drag-and-drop coordinator, focus ring manager, debounced scroll broadcaster). Logic that is awkward to express in a component AND has no domain meaning.

**Renderer services DO NOT own:** cross-store coordination on system events (main emits, each store reacts via a subscription registrar), multi-step state machines that orchestrate tRPC calls (that is a main service), anything that fetches data or holds business state.

**Main process services own:** business logic and orchestration, polling loops, retries, dedup, batching, data fetching, parsing, transformation, long-lived host state (registries, watchers, OAuth flow state), cross-service coordination, emission of typed events.

When multiple stores need to react to one event (logout clearing auth + seats + settings + navigation), main emits the event and each store reacts in its feature's subscription registrar. Stores never reach into other stores.

---

## Project structure

- Monorepo with pnpm workspaces and turbo
- `apps/code` PostHog Code Electron desktop app (React + Vite)
- `apps/cli` CLI app, thin shell over the external `@posthog/cli` npm package
- `apps/mobile` React Native mobile app (Expo)
- `packages/agent` TypeScript agent framework wrapping the Claude Agent SDK
- `packages/git` Git saga operations, gh CLI client, read-write locks
- `packages/enricher` AST-level PostHog flag detection across multiple languages
- `packages/platform` Interface-only declarations for host capabilities (fulfilled by per-target adapters in `apps/code/src/main/platform-adapters/`)
- `packages/electron-trpc` tRPC-over-Electron-IPC bridge
- `packages/shared` Zero-dependency shared utilities (Saga pattern, cloud-prompt encoding)

## Commands

- `pnpm install` Install all dependencies
- `pnpm dev` Run both agent (watch) and code app via phrocs
- `pnpm dev:mprocs` Run both agent (watch) and code app via mprocs
- `pnpm dev:agent` Run agent package in watch mode only
- `pnpm dev:code` Run code desktop app only
- `pnpm build` Build all packages (turbo)
- `pnpm typecheck` Type check all packages
- `pnpm lint` Lint and auto-fix with biome
- `pnpm format` Format with biome
- `pnpm test` Run tests across all packages

### Code app

- `pnpm --filter code test` Run vitest tests
- `pnpm --filter code typecheck` Type check code app
- `pnpm --filter code package` Package electron app
- `pnpm --filter code make` Make distributable

### Agent package

- `pnpm --filter agent build` Build agent with tsup
- `pnpm --filter agent dev` Watch mode build
- `pnpm --filter agent typecheck` Type check agent

### Shared package

- `pnpm --filter @posthog/shared build` Build shared with tsup
- `pnpm --filter @posthog/shared dev` Watch mode build
- `pnpm --filter @posthog/shared typecheck` Type check shared

---

## Code style

- Prefer writing our own solution over adding external packages when the fix is simple
- Keep functions focused with single responsibility
- Biome for linting and formatting (not ESLint or Prettier)
- 2-space indentation, double quotes
- No `console.*` in source. Use the logger instead (logger files exempt)
- Path aliases required in renderer code, no relative imports: `@features/*`, `@components/*`, `@stores/*`, `@hooks/*`, `@utils/*`, `@renderer/*`, `@shared/*`, `@api/*`
- Main process path aliases: `@main/*`, `@api/*`, `@shared/*`
- TypeScript strict mode enabled
- Tailwind CSS classes should be sorted (biome `useSortedClasses` rule)
- No barrel files (`index.ts`). Import directly from source
- Tailwind first, inline `style` only for dynamic values, library config, or CSS-var passthrough
- Use the scoped logger (`logger.scope(...)`) not `console`
- Abort controllers fire **before** awaiting cleanup that depends on them (otherwise deadlock)

See [docs/conventions.md](./docs/conventions.md) for full examples of Tailwind rules, Zustand store shape, analytics event naming, and other code conventions.

## Agent integration guidelines

- **No rawInput**: Don't use Claude Code SDK's `rawInput`. Only use Zod validated meta fields. This keeps us agent agnostic and gives us a maintainable, extensible format for logs.
- **Use ACP SDK types**: Don't roll your own types for things available in the ACP SDK. Import types directly from `@anthropic-ai/claude-agent-sdk`.
- **Permissions via tool calls**: If something requires user input or approval, implement it through a tool call with a permission instead of custom methods plus notifications. Avoid patterns like `_array/permission_request`.

## Key libraries

- React 19, Radix UI Themes, Tailwind CSS
- TanStack Query for data fetching, TanStack Router for routing
- xterm.js for terminal emulation
- CodeMirror for code editing
- Tiptap for rich text
- Zod for schema validation
- InversifyJS for dependency injection
- Sonner for toast notifications

---

## Testing

- `pnpm test` runs unit tests, `pnpm test:e2e` runs Playwright.
- Unit tests (Vitest) for stores, utilities, service methods with mocked deps, business logic.
- E2E tests (Playwright) for critical user journeys, IPC, Electron-API-dependent features, regressions.
- Rule of thumb: if it can be tested without Electron running, use a unit test.
- Tests are colocated as `.test.ts` / `.test.tsx`. E2E tests live in `tests/e2e/`.

See [docs/testing.md](./docs/testing.md) for store testing patterns, mocking patterns, and test helpers.

---

## Directory structure

```
apps/code/src/
├── main/
│   ├── di/                   # InversifyJS container + tokens
│   ├── services/             # Services own all business logic and I/O
│   ├── platform-adapters/    # Electron implementations of @posthog/platform interfaces
│   ├── trpc/
│   │   ├── router.ts         # Root router combining all routers
│   │   └── routers/          # One router per service
│   └── lib/logger.ts
├── renderer/
│   ├── di/                   # Renderer DI container (tRPC client + narrow renderer services)
│   ├── features/             # Feature modules (sessions, tasks, terminal, etc.)
│   │   └── <feature>/subscriptions.ts  # Subscription registrars wired once at boot
│   ├── stores/               # Zustand stores (pure UI state + subscription caches)
│   ├── services/             # Narrow renderer services (UI mechanics only)
│   ├── hooks/                # Custom React hooks
│   ├── components/           # Shared components
│   ├── trpc/client.ts        # tRPC client setup
│   └── utils/                # Utilities, logger, analytics, etc.
├── shared/                   # Shared between main & renderer
│   ├── types.ts              # Shared type definitions
│   └── constants.ts
├── api/                      # PostHog API client
└── test/                     # Test utilities
```

---

## Environment variables

- Copy `.env.example` to `.env`

---

## Reference docs

- [docs/architecture.md](./docs/architecture.md) Electron process model, DI, IPC via tRPC, services, events, MCP apps, package roles.
- [docs/conventions.md](./docs/conventions.md) Tailwind rules, store/component patterns, async cleanup, logger, analytics events naming.
- [docs/testing.md](./docs/testing.md) Test patterns, store testing, mocking, test helpers.
