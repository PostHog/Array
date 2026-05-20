# PostHog Code Development Guide

This is the single source of truth for how PostHog Code is built. Architecture rules, conventions, recipes and patterns all live here. If something contradicts this file, this file wins.

## Architecture rules (read this first)

Read this section before writing or modifying code. These rules are load-bearing. They are what keeps business logic out of the renderer and lets the app stay portable to other clients.

**The principle: three layers, each with one job.**

| Layer                          | One job                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Main process services**      | All business logic and I/O. Orchestration, fetching, polling, parsing, auth, side effects, system telemetry. |
| **Renderer Zustand stores**    | Pure UI state. Subscription-fed caches. Thin action wrappers over tRPC. Nothing else.                        |
| **React components and hooks** | Render the store. Wire user input to store actions or tRPC mutations. Local component state only.            |

**Renderer services are a narrow escape hatch.** Only for renderer-only UI mechanics shared across components (visual queues, drag-and-drop, focus rings). Never for data fetching, never for cross-store coordination on system events, never for multi-step async orchestration.

### Rules in one screen

- **R1** Main services own business logic. `@injectable()`, singleton, exposed via a tRPC router with Zod schemas in the service's `schemas.ts`. No imports from `apps/code/src/renderer/*`.
- **R2** Zustand stores are thin: UI state, subscription caches or queues. Actions do at most one `trpcClient` call plus one state update. No module-level `let` promises, no cross-store reach-ins, no business clients, no query-cache surgery, no system-event analytics.
- **R3** Renderer services are a narrow escape hatch. They live in `apps/code/src/renderer/services/`, are `@injectable()`, and never fetch data or coordinate cross-store reactions to system events.
- **R4** Components use `useQuery` and `useMutation`, not imperative `trpcClient` calls. Custom hooks wrap a single query or a store selector. Hooks that orchestrate multiple queries to derive a result become one tRPC procedure.
- **R5** Cross-feature coordination happens in main. Main emits an event; each affected store reacts via its feature's subscription registrar. Stores never reach into other stores.
- **R6** Every tRPC procedure has Zod `input` and (where it returns data) Zod `output`. Types are inferred from schemas, never declared separately.
- **R7** Persistence and platform APIs are main. The renderer persists pure UI prefs via `electronStorage`. Domain data persists in the SQLite DB via a `Repository`.
- **R8** No `container.get(...)` inside service methods. Constructor injection only. A circular dep means the boundary is wrong; split or invert via events.
- **R9** Subscriptions are wired once per feature in `apps/code/src/renderer/features/<feature>/subscriptions.ts`, started at app boot. Components do not start subscriptions ad hoc.
- **R10** tRPC routers are one-liners. No inline business logic. No reaching past the service to a repository. No router without a backing service.

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

- **Module-level dedup state in stores.** `let inFlightAuthSync: Promise | null` and friends. Dedup belongs in the service.
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

When in doubt, push logic toward main. The renderer is being thinned out, not thickened.

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

### Services over hooks for business logic

Put data-fetching logic and derivation in main process services, not renderer hooks. Hooks should be thin wrappers around a single tRPC query. If a hook orchestrates multiple queries and derives a result, that logic belongs in a service exposed via tRPC so it can be reused from both the main process and the renderer.

### Small focused components

Extract distinct UI concerns into their own components instead of building long inline ternary chains or conditional blocks. If a section of JSX handles its own logic (e.g. icon selection based on state), pull it into a named component next to where it's used. Keep render functions short and scannable.

### Async cleanup ordering

When tearing down async operations that use an AbortController, always abort the controller **before** awaiting any cleanup that depends on it. Otherwise you get a deadlock: the cleanup waits for the operation to stop, but the operation won't stop until the abort signal fires.

```typescript
// WRONG - deadlocks if interrupt() waits for the operation to finish
await this.interrupt();          // hangs: waits for query to stop
this.abortController.abort();    // never reached

// RIGHT - abort first so the operation can actually stop
this.abortController.abort();    // cancels in-flight HTTP requests
await this.interrupt();          // resolves because the query was aborted
```

### Avoid barrel files

Do not make use of `index.ts`. Barrel files:

- Break tree-shaking
- Create circular dependency risks
- Hide the true source of imports
- Make refactoring harder

Import directly from source files instead.

---

## Architecture

### Electron app (apps/code)

The desktop app has two processes. Main is the system of record for business logic and host state. Renderer owns UI state via Zustand and renders the world the main process describes.

```
Main Process (Node.js)                      Renderer Process (React)
┌───────────────────────┐                   ┌───────────────────────────┐
│  DI Container         │                   │  DI Container             │
│  ├── GitService       │                   │  ├── TRPCClient           │
│  └── ...              │                   │  └── narrow renderer svcs │
├───────────────────────┤                   ├───────────────────────────┤
│  tRPC Routers         │ ◄─tRPC(ipcLink)─► │  tRPC Clients             │
│  (resolve services)   │                   │  ├── useTRPC() (hooks)    │
├───────────────────────┤                   │  └── trpcClient (vanilla) │
│  Services + I/O       │                   ├───────────────────────────┤
│  (fs, git, shell,     │                   │  Zustand Stores           │
│   business logic)     │                   │  ├── pure UI state        │
└───────────────────────┘                   │  └── subscription caches  │
                                            ├───────────────────────────┤
                                            │  React UI                 │
                                            └───────────────────────────┘
```

- Both processes use InversifyJS for DI with singleton scope
- Main holds all services. Renderer DI holds the tRPC client and narrow renderer services
- Zustand stores own all UI state (not in DI)
- Main services emit typed events. Renderer reacts via tRPC subscriptions wired once at boot

### Dependency injection

Both processes use [InversifyJS](https://inversify.io/) with singleton scope. Services declare dependencies via constructor injection. No `container.get(...)` inside service methods.

**Define a service:**

```typescript
// src/main/services/my-service/service.ts
import { injectable } from "inversify"

@injectable()
export class MyService {
  doSomething() {
    // ...
  }
}
```

**Register the token and binding:**

```typescript
// src/main/di/tokens.ts
export const MAIN_TOKENS = Object.freeze({
  MyService: Symbol.for("Main.MyService"),
})

// src/main/di/container.ts
container.bind<MyService>(MAIN_TOKENS.MyService).to(MyService)
```

**Inject dependencies via constructor:**

```typescript
import { inject, injectable } from "inversify"
import { MAIN_TOKENS } from "../di/tokens"

@injectable()
export class MyService {
  constructor(
    @inject(MAIN_TOKENS.OtherService)
    private readonly otherService: OtherService,
  ) {}
}
```

**Test with mocks via constructor injection or container rebind:**

```typescript
// Direct instantiation
const mockOther = { getData: vi.fn().mockReturnValue("test") }
const service = new MyService(mockOther as OtherService)

// Or rebind in container for integration tests
container.snapshot()
container.rebind(MAIN_TOKENS.OtherService).toConstantValue(mockOther)
// ... run tests
container.restore()
```

### IPC via tRPC

We use [tRPC](https://trpc.io/) over Electron IPC via the workspace `@posthog/electron-trpc` package. All inputs and outputs are Zod schemas. Types are inferred from schemas, never declared separately.

**Three tRPC exports, each for a different context:**

| Export       | Where to use                                  | Purpose                                                                  |
| ------------ | --------------------------------------------- | ------------------------------------------------------------------------ |
| `useTRPC()`  | React components and hooks                    | Options proxy via React context                                          |
| `trpc`       | Outside React (module scope, services, stores) | Options proxy bound to the singleton `queryClient`                       |
| `trpcClient` | Anywhere (imperative calls)                   | Vanilla tRPC client for direct `.query()` / `.mutate()` / `.subscribe()` |

**Create a router (main process). Routers are one-liners that delegate to a backing service:**

```typescript
// src/main/trpc/routers/my-router.ts
import { container } from "../../di/container"
import { MAIN_TOKENS } from "../../di/tokens"
import {
  getDataInput,
  getDataOutput,
  updateDataInput,
} from "../../services/my-service/schemas"
import { router, publicProcedure } from "../trpc"

const getService = () => container.get<MyService>(MAIN_TOKENS.MyService)

export const myRouter = router({
  getData: publicProcedure
    .input(getDataInput)
    .output(getDataOutput)
    .query(({ input }) => getService().getData(input.id)),

  updateData: publicProcedure
    .input(updateDataInput)
    .mutation(({ input }) => getService().updateData(input.id, input.value)),
})
```

**Register the router on the root:**

```typescript
// src/main/trpc/router.ts
import { myRouter } from "./routers/my-router"

export const trpcRouter = router({
  my: myRouter,
  // ...
})
```

**Use in React with TanStack Query:**

```typescript
import { useTRPC } from "@renderer/trpc/client"
import { useMutation, useQuery } from "@tanstack/react-query"

function MyComponent() {
  const trpc = useTRPC()

  const { data } = useQuery(trpc.my.getData.queryOptions({ id: "123" }))

  const mutation = useMutation(
    trpc.my.updateData.mutationOptions({
      onSuccess: () => { /* ... */ },
    }),
  )
  const handleUpdate = () => mutation.mutate({ id: "123", value: "new" })
}
```

**Cache invalidation uses `pathFilter()` or `queryFilter()`:**

```typescript
const queryClient = useQueryClient()

// Invalidate all queries under a router path
queryClient.invalidateQueries(trpc.workspace.getAll.pathFilter())

// Invalidate a specific query by input
queryClient.invalidateQueries(
  trpc.git.getCurrentBranch.queryFilter({ directoryPath: repoPath }),
)

// Set cache data directly
queryClient.setQueryData(
  trpc.git.getLatestCommit.queryKey({ directoryPath: repoPath }),
  commitData,
)
```

**Outside React (stores, sagas, module-scope utilities):**

```typescript
// Imperative calls use trpcClient
import { trpcClient } from "@renderer/trpc/client"

const data = await trpcClient.my.getData.query({ id: "123" })
await trpcClient.my.updateData.mutate({ id: "123", value: "new" })

// Cache operations outside React use trpc (the module-level options proxy)
import { trpc } from "@renderer/trpc"
import { queryClient } from "@utils/queryClient"

queryClient.invalidateQueries(trpc.workspace.getAll.pathFilter())
```

### State management

All UI state lives in the renderer. Domain state and host state live in main and are exposed via tRPC. Anything that survives a renderer reload, or that another client (mobile, web, CLI) would also need, lives in main.

```typescript
// ❌ Bad - main service hoarding renderer-shaped state
@injectable()
class TaskService {
  private currentTask: Task | null = null // belongs in renderer
}

// ✅ Good - main service is the system of record for task data
@injectable()
class TaskService {
  async readTask(id: string): Promise<Task> { /* ... */ }
  async writeTask(task: Task): Promise<void> { /* ... */ }
}

// ✅ Good - renderer state is pure UI selection
const useTaskUiStore = create<TaskUiState>((set) => ({
  currentTaskId: null,
  setCurrentTaskId: (id) => set({ currentTaskId: id }),
}))
```

This keeps state predictable, easy to debug and naturally supports patterns like undo and rollback.

### Services

Main services live in `src/main/services/<feature>/`:

```
src/main/services/
└── my-service/
    ├── service.ts      # The @injectable() service class
    ├── schemas.ts      # Zod schemas + event constants for tRPC
    └── types.ts        # Internal types (not exposed via tRPC)
```

**Zod schemas are the source of truth.** Types are inferred from schemas, never declared separately.

```typescript
// src/main/services/my-service/schemas.ts
import { z } from "zod"

export const getDataInput = z.object({ id: z.string() })

export const getDataOutput = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
})

export type GetDataInput = z.infer<typeof getDataInput>
export type GetDataOutput = z.infer<typeof getDataOutput>
```

Services and routers import the schemas and inferred types from the same `schemas.ts`. The router validates at the boundary; the service consumes the inferred types.

### Events (tRPC subscriptions)

For pushing real-time updates from main to renderer, services extend `TypedEventEmitter` and routers expose them as subscriptions.

**Define event names and payload types in `schemas.ts`:**

```typescript
// src/main/services/my-service/schemas.ts
export const MyServiceEvent = {
  ItemCreated: "item-created",
  ItemDeleted: "item-deleted",
} as const

export interface MyServiceEvents {
  [MyServiceEvent.ItemCreated]: { id: string; name: string }
  [MyServiceEvent.ItemDeleted]: { id: string }
}
```

**Extend `TypedEventEmitter` in the service:**

```typescript
// src/main/services/my-service/service.ts
import { TypedEventEmitter } from "../../lib/typed-event-emitter"
import { MyServiceEvent, type MyServiceEvents } from "./schemas"

@injectable()
export class MyService extends TypedEventEmitter<MyServiceEvents> {
  async createItem(name: string) {
    const item = { id: "123", name }
    this.emit(MyServiceEvent.ItemCreated, item) // typed
    return item
  }
}
```

**Expose as subscriptions via `toIterable()`. Global events broadcast to all subscribers:**

```typescript
function subscribe<K extends keyof MyServiceEvents>(event: K) {
  return publicProcedure.subscription(async function* (opts) {
    const service = getService()
    for await (const data of service.toIterable(event, { signal: opts.signal })) {
      yield data
    }
  })
}

export const myRouter = router({
  // ... queries and mutations
  onItemCreated: subscribe(MyServiceEvent.ItemCreated),
  onItemDeleted: subscribe(MyServiceEvent.ItemDeleted),
})
```

**For per-instance events (shell sessions, workspaces, etc.), filter server-side rather than broadcasting:**

```typescript
export interface ShellEvents {
  [ShellEvent.Data]: { sessionId: string; data: string }
  [ShellEvent.Exit]: { sessionId: string; exitCode: number }
}

function subscribeFiltered<K extends keyof ShellEvents>(event: K) {
  return publicProcedure
    .input(sessionIdInput)
    .subscription(async function* (opts) {
      const service = getService()
      const targetSessionId = opts.input.sessionId
      for await (const data of service.toIterable(event, { signal: opts.signal })) {
        if (data.sessionId === targetSessionId) yield data
      }
    })
}
```

**Subscribe in the renderer via the feature's subscription registrar, not in components:**

```typescript
// src/renderer/features/my-feature/subscriptions.ts
import { trpcClient } from "@renderer/trpc/client"

export function registerMyFeatureSubscriptions() {
  trpcClient.my.onItemCreated.subscribe(undefined, {
    onData: (item) => useMyStore.getState().handleItemCreated(item),
  })
}
```

Subscriptions are started once at app boot. Components do not start subscriptions ad hoc.

### Adding a new feature

1. Create the service in `src/main/services/<feature>/`. Add `schemas.ts` for Zod inputs, outputs and event types.
2. Add a DI token in `src/main/di/tokens.ts`.
3. Register the service in `src/main/di/container.ts`.
4. Create a tRPC router in `src/main/trpc/routers/<feature>.ts`. Routers are one-liners that delegate to the service.
5. Mount the router on the root in `src/main/trpc/router.ts`.
6. In the renderer, consume the procedures via `useQuery` and `useMutation`. If the feature pushes events, add a subscription registrar in `src/renderer/features/<feature>/subscriptions.ts` and register it at boot.

### MCP apps

MCP Apps let MCP servers ship interactive HTML UIs alongside their tools. When a tool has an associated `ui://` resource, we render the app's HTML inside a sandboxed iframe instead of the raw tool input and output.

- Schemas live in `src/shared/types/mcp-apps.ts` because both processes need them.
- `McpAppsService` (`src/main/services/mcp-apps/service.ts`) manages MCP server connections, caches resources (capped at 5MB per resource) and proxies calls between the renderer and remote servers.
- `AgentService` intercepts ACP `sessionUpdate` callbacks for `mcp__` tools and forwards inputs and results to `McpAppsService`.
- The renderer feature is `src/renderer/features/mcp-apps/`. `McpToolBlock` always renders `McpToolView` and additionally renders `McpAppHost` when the tool has a UI resource and the server isn't disabled.
- Apps run in a double-iframe sandbox. The outer iframe loads a generated proxy with `sandbox="allow-scripts allow-same-origin ..."` and the inner iframe enforces a server-declared CSP meta tag.
- `useAppBridge` manages the host side of `@modelcontextprotocol/ext-apps`. App requests route to tRPC mutations. Host context (theme, display mode, dimensions) flows back via the bridge.
- Users can disable MCP Apps per server via `settingsStore.mcpAppsDisabledServers`.

### Other packages

- **`packages/agent`** TypeScript agent framework wrapping `@anthropic-ai/claude-agent-sdk`. Owns the ACP connection, worktree management, PostHog API integration, task execution and session management. The cloud agent server is exported via `@posthog/agent/server`.
- **`packages/git`** Platform-agnostic git saga operations (clone, branch, commit, push, stash, worktree, patch, publish), a read-write lock and a gh CLI client. Depends only on `@posthog/shared` and `@posthog/platform`.
- **`packages/enricher`** AST-based PostHog flag call detection and source enrichment across languages. No workspace dependencies. Reusable from any host (Electron, mobile, CI, server).
- **`packages/platform`** Interface-only. Declares the host capabilities a service can depend on (`ISecureStorage`, `IClipboard`, `IDialog`, `INotifier`, `IUpdater`, `IShell`, `IFileSystem`, etc.). No implementations. Per-target adapters fulfill the interfaces. Electron adapters live in `apps/code/src/main/platform-adapters/`. Future React Native and web adapters will live in their respective apps. Domain packages and main services depend on these interfaces, never on Electron APIs directly.
- **`packages/electron-trpc`** tRPC-over-Electron-IPC bridge.
- **`packages/shared`** Zero-dependency shared utilities (Saga pattern for atomic multi-step operations with automatic rollback, cloud-prompt encoding). Built with tsup, outputs ESM.
- **`apps/cli`** Thin shell over the external `@posthog/cli` npm package. Command files handle argument parsing and output formatting only. No business logic. No data transformation. No tree building.

---

## Agent integration guidelines

- **No rawInput**: Don't use Claude Code SDK's `rawInput`. Only use Zod validated meta fields. This keeps us agent agnostic and gives us a maintainable, extensible format for logs.
- **Use ACP SDK types**: Don't roll your own types for things available in the ACP SDK. Import types directly from `@anthropic-ai/claude-agent-sdk`.
- **Permissions via tool calls**: If something requires user input or approval, implement it through a tool call with a permission instead of custom methods plus notifications. Avoid patterns like `_array/permission_request`.

## Key libraries

- React 19, Radix UI Themes, Tailwind CSS
- TanStack Query for data fetching
- xterm.js for terminal emulation
- CodeMirror for code editing
- Tiptap for rich text
- Zod for schema validation
- InversifyJS for dependency injection
- Sonner for toast notifications

---

## Patterns

### Store / service boundary

Stores and services have a strict separation of concerns:

```
Renderer                              Main Process
+------------------+                  +------------------+
|  Zustand Store   |  -- tRPC -->     |  tRPC Router     |
|                  |  <-- subs --     +------------------+
|  - Pure state    |                         |
|  - Event cache   |                  +------------------+
|  - UI concerns   |                  |  Service         |
|  - Thin actions  |                  |                  |
+------------------+                  | - Orchestration  |
        |                             | - Polling        |
+------------------+                  | - Data fetching  |
|  Renderer Svc    |                  | - Business logic |
| (narrow only)    |                  +------------------+
| - UI mechanics   |
+------------------+
```

**Renderer stores own:**
- Pure UI state (open/closed, selected item, scroll position)
- Cached data from subscriptions
- Message queues and event buffers
- Permission display state
- Thin action wrappers that call tRPC mutations

**Renderer services own (narrow escape hatch only):**
- Renderer-only UI mechanics shared across more than one component (visual action queues, global drag-and-drop coordinator, focus ring manager, debounced scroll broadcaster)
- Logic that is awkward to express in a component AND has no domain meaning

**Renderer services DO NOT own:**
- Cross-store coordination on system events (that belongs in main, with each store reacting to an emitted event via a subscription registrar)
- Multi-step state machines that orchestrate tRPC calls (that is a main service exposed as a single procedure)
- Anything that fetches data, talks to PostHog or holds business state

**Main process services own:**
- Business logic and orchestration
- Polling loops, retries, dedup, batching
- Data fetching, parsing, transformation
- Long-lived host state (registries, watchers, OAuth flow state)
- Cross-service coordination
- Emission of typed events for the renderer to react to

Stores never contain business logic, orchestration or data fetching. If a store action does more than update local state or call a single tRPC method, that logic belongs in a main service. When multiple stores need to react to one event (logout clearing auth + seats + settings + navigation), main emits the event and each store reacts via its feature's subscription registrar in `apps/code/src/renderer/features/<feature>/subscriptions.ts`. Stores never reach into other stores.

### Zustand stores

Stores hold pure state with thin actions. Separate state and action interfaces. Use persistence middleware where needed:

```typescript
interface SidebarStoreState {
  open: boolean;
  width: number;
}

interface SidebarStoreActions {
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

type SidebarStore = SidebarStoreState & SidebarStoreActions;

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      open: false,
      width: 256,
      setOpen: (open) => set({ open }),
      toggle: () => set((state) => ({ open: !state.open })),
    }),
    {
      name: "sidebar-storage",
      partialize: (state) => ({ open: state.open, width: state.width }),
    }
  )
);
```

### React components

Components are functional with hooks. Props typed with interfaces:

```typescript
interface AgentMessageProps {
  content: string;
}

export function AgentMessage({ content }: AgentMessageProps) {
  return (
    <Box className="py-1 pl-3">
      <MarkdownRenderer content={content} />
    </Box>
  );
}
```

Complex components organize hooks by concern (data, UI state, side effects):

```typescript
export function TaskDetail({ task: initialTask }: TaskDetailProps) {
  const taskId = initialTask.id;
  useTaskData({ taskId, initialTask });  // Data fetching

  const workspace = useWorkspaceStore((state) => state.workspaces[taskId]);  // Store
  const [filePickerOpen, setFilePickerOpen] = useState(false);  // Local state

  useHotkeys("mod+p", () => setFilePickerOpen(true), {...});  // Effects
  useFileWatcher(effectiveRepoPath ?? null, taskId);
  // ...
}
```

### Tailwind over inline styles

Always reach for Tailwind utility classes first. The codebase uses Tailwind v4 with CSS variables from Radix Themes (e.g. `--gray-12`, `--space-3`, `--radius-2`). Use Tailwind v4's CSS-var shorthand to bridge them: `text-(--gray-12)`, `bg-(--gray-2)`, `rounded-(--radius-2)`, `border-(--gray-5)`. Use arbitrary values (`text-[13px]`, `pl-[18px]`) when the design token doesn't have a named match.

Inline `style={{}}` is acceptable in three cases only:

1. **Genuinely dynamic values** computed at runtime that can't be a class. E.g. `style={{ width: ${pxFromHook}px }}`, `style={{ transform: translateY(${y}px) }}`, pixel positions from measurement, data-driven colors that don't fit a fixed palette.
2. **Library configuration** passed to non-React libraries (CodeMirror's `EditorView.theme(...)`, xterm.js options, etc.).
3. **CSS variables set from JS** that downstream classes consume. `style={{ "--row-color": item.color }}` paired with `className="bg-(--row-color)"`.

Do NOT use inline `style` for:

- Color tokens (use `text-(--gray-12)`, `bg-(--gray-2)`, `border-(--gray-5)`)
- Spacing (use `p-3`, `mt-2`, `pl-4`, `gap-2`). Radix `--space-N` matches Tailwind's spacing scale 1:1 for `--space-1`..`--space-4`. `--space-5` = `6`, `--space-6` = `8`, etc.
- Layout primitives (`shrink-0`, `min-w-0`, `flex-1`, `overflow-y-auto`, `w-full`, `h-full`)
- Borders (`border border-(--gray-5)`), radii (`rounded-(--radius-2)` or `rounded-full`)
- Cursors (`cursor-pointer`, `cursor-col-resize`)
- Opacity (`opacity-50`), text-align, text-transform (`uppercase`), white-space, word-break
- Position (`absolute`, `relative`, `fixed`), z-index (`z-10`, `z-[201]`), inset (`inset-0`)
- Animations that map to a Tailwind utility (`animate-spin`)
- Conditional values that can be `className={cond ? "x" : "y"}` or ``className={`base-classes ${cond ? "active-classes" : "inactive-classes"}`}``

Default line-heights have been tightened in [apps/code/src/renderer/styles/globals.css](./apps/code/src/renderer/styles/globals.css). Don't add a `leading-*` class for body text unless you specifically want a non-default line-height. For arbitrary sizes (`text-[13px]`), pair with `leading-snug` for body text or `leading-tight` for titles.

When writing a custom React component that wraps a styled element, accept BOTH `className?: string` and `style?: React.CSSProperties` props and merge the `className` into the inner element's classes (e.g. ``className={`base-classes ${className ?? ""}`}``). This lets call sites override styling via Tailwind without forcing inline `style`.

### Custom hooks

Hooks extract store subscriptions or single tRPC queries into cleaner interfaces. Hooks that orchestrate multiple queries belong in a service instead:

```typescript
export function useConnectivity() {
  const isOnline = useConnectivityStore((s) => s.isOnline);
  const check = useConnectivityStore((s) => s.check);
  return { isOnline, check };
}
```

### Learned hints

The settings store (`src/renderer/features/settings/stores/settingsStore.ts`) provides a reusable "learned hints" system for progressive feature discovery. Hints are shown a limited number of times until the user demonstrates they've learned the behavior.

```typescript
const store = useFeatureSettingsStore.getState()

// Check if a hint should still be shown (max N times, not yet learned)
if (store.shouldShowHint("my-hint-key", 3)) {
  store.recordHintShown("my-hint-key")
  toast.info("Did you know?", "You can do X with Y.")
}

// When the user demonstrates the behavior, mark it learned (stops showing)
store.markHintLearned("my-hint-key")
```

Hint state is persisted via `electronStorage`. Use this pattern instead of ad-hoc boolean flags when introducing new discoverable features.

### Logger usage

Use the scoped logger instead of `console`:

```typescript
const log = logger.scope("navigation-store");

export const useNavigationStore = create<NavigationStore>()(
  persist((set, get) => {
    log.info("Folder path is stale, redirecting...", { folderId: folder.id });
    // ...
  })
);
```

### Analytics events

Two PostHog clients emit events:

- **Renderer** (`posthog-js`) via `track(eventName, properties)` in `src/renderer/utils/analytics.ts`
- **Main** (`posthog-node`) via `trackAppEvent(eventName, properties)` in `src/main/services/posthog-analytics.ts`

Both register a super-property `team: "posthog-code"`. All event names and property types are defined in `ANALYTICS_EVENTS` and `EventPropertyMap` in `src/shared/types/analytics.ts`. Adding a new event without entries there will fail typechecking.

**Event names**

- Format: `Object verbed`. Title Case, sentence-cased, spaces between words.
- First word is the object (`Task`, `Prompt`, `Branch`, `File`).
- Second word is a past-tense verb (`created`, `viewed`, `sent`, `started`, `completed`, `failed`, `cancelled`).
- Only the first word is capitalized. Spell out abbreviations (`Pull request created`, not `PR created`).
- Group by object, not by feature. Prefer `Branch linked` over `Workspace branch linked`.
- Prefer a generic event with a discriminator property over many bespoke events. `Setting changed` with `setting_name`, not `Theme changed` plus `Font changed`.
- Do not prefix events with `First`. "First X" is always derivable in PostHog from the first occurrence of `X` per distinct ID.

Good: `Task created`, `Prompt sent`, `Setup discovery completed`, `Onboarding step completed`
Bad: `task_created`, `TaskCreated`, `created_task`, `userClickedSendButton`, `PR created`

**Property names**

- snake_case, lowercase, no leading underscore.
- Booleans: prefix with `is_`, `has_` or `can_` (`is_initial`, `has_branch`, `has_uncommitted_changes`).
- Counts: suffix with `_count` (`event_count`, `staged_file_count`).
- Durations and sizes: suffix with the unit (`duration_seconds`, `prompt_length_chars`).
- IDs: suffix with `_id` (`task_id`, `discovery_task_run_id`).
- Enums: suffix with `_type`, `_mode`, `_source`, `_kind`, `_reason`, `_action`, or the bare noun if obvious (`category`, `region`).
- Pairs: when capturing a transition, use `from_*` / `to_*` (`from_mode`, `to_mode`).

**Enum values**

- snake_case strings, lowercase (`"user_cancelled"`, `"stale_feature_flag"`).
- Never `true`/`false` as a state value. Use a meaningful enum (`"completed"` / `"cancelled"` / `"failed"`, not `success: true/false` unless it really is just success).
- Closed enums get a TypeScript union in `analytics.ts`. Open-ended values are fine when the set evolves freely (e.g. `setting_name`).

**What does not go into properties**

- No PII in event names or property values. No email addresses, full names, file paths, prompt contents, repo URLs. Hash if you need to dedupe (`path_hash`).
- No free-form strings when an enum will do.
- No giant payloads. If the value can be reconstructed from another event plus an ID, store the ID.

---

## Testing

### Commands

- `pnpm test` Run unit tests across all packages
- `pnpm --filter code test` Run code unit tests only
- `pnpm test:e2e` Run Playwright E2E tests

### When to write unit tests vs E2E tests

**Unit tests (Vitest)** Fast, isolated, run frequently:
- Zustand store logic and state transitions
- Pure utility functions and helpers
- Service methods with mocked dependencies
- Complex business logic in isolation
- Data transformations and validators

**E2E tests (Playwright)** Slower, test real user flows:
- Critical user journeys (auth, task creation, workspace setup)
- IPC communication between main and renderer
- Features requiring real Electron APIs (file system, shell)
- Multi-step workflows spanning multiple components
- Regression tests for reported bugs

**Rule of thumb**: If it can be tested without Electron running, use a unit test. If it requires the full app context or tests user-facing behavior, use E2E.

### Test file location

Tests are colocated with source code using `.test.ts` or `.test.tsx` extension. E2E tests live in `tests/e2e/`.

### Store testing

```typescript
describe("store", () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ /* reset state */ });
  });

  it("action changes state", () => {
    useStore.getState().action();
    expect(useStore.getState().property).toBe(expectedValue);
  });

  it("persists to localStorage", () => {
    useStore.getState().action();
    const persisted = localStorage.getItem("store-key");
    expect(JSON.parse(persisted).state).toEqual(expectedState);
  });
});
```

### Mocking patterns

**Hoisted mocks for complex modules:**
```typescript
const mockPty = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node-pty", () => mockPty);
```

**Simple module mocks:**
```typescript
vi.mock("@utils/analytics", () => ({ track: vi.fn() }));
```

**Global fetch stubbing:**
```typescript
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
mockFetch.mockResolvedValueOnce(ok());
```

### Test helpers

Test utilities are in `src/test/`:
- `setup.ts` Global test setup with localStorage mock
- `utils.tsx` `renderWithProviders()` for component tests
- `fixtures.ts` Mock data factories
- `panelTestHelpers.ts` Domain-specific assertions

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
