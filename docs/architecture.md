# Architecture reference

Deep reference for the patterns that the architecture rules in [AGENTS.md](../AGENTS.md) point at. Read AGENTS.md first; this file is the long form.

## Electron app (apps/code)

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

## Dependency injection

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

## IPC via tRPC

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

## State management

All UI state lives in the renderer. Domain state and host state live in main and are exposed via tRPC. Anything that survives a renderer reload, or that another client (mobile, web, CLI) would also need, lives in main.

```typescript
// Bad - main service hoarding renderer-shaped state
@injectable()
class TaskService {
  private currentTask: Task | null = null // belongs in renderer
}

// Good - main service is the system of record for task data
@injectable()
class TaskService {
  async readTask(id: string): Promise<Task> { /* ... */ }
  async writeTask(task: Task): Promise<void> { /* ... */ }
}

// Good - renderer state is pure UI selection
const useTaskUiStore = create<TaskUiState>((set) => ({
  currentTaskId: null,
  setCurrentTaskId: (id) => set({ currentTaskId: id }),
}))
```

This keeps state predictable, easy to debug and naturally supports patterns like undo and rollback.

## Service file layout

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

## Events (tRPC subscriptions)

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

## Adding a new feature

1. Create the service in `src/main/services/<feature>/`. Add `schemas.ts` for Zod inputs, outputs and event types.
2. Add a DI token in `src/main/di/tokens.ts`.
3. Register the service in `src/main/di/container.ts`.
4. Create a tRPC router in `src/main/trpc/routers/<feature>.ts`. Routers are one-liners that delegate to the service.
5. Mount the router on the root in `src/main/trpc/router.ts`.
6. In the renderer, consume the procedures via `useQuery` and `useMutation`. If the feature pushes events, add a subscription registrar in `src/renderer/features/<feature>/subscriptions.ts` and register it at boot.

## MCP apps

MCP Apps let MCP servers ship interactive HTML UIs alongside their tools. When a tool has an associated `ui://` resource, we render the app's HTML inside a sandboxed iframe instead of the raw tool input and output.

- Schemas live in `src/shared/types/mcp-apps.ts` because both processes need them.
- `McpAppsService` (`src/main/services/mcp-apps/service.ts`) manages MCP server connections, caches resources (capped at 5MB per resource) and proxies calls between the renderer and remote servers.
- `AgentService` intercepts ACP `sessionUpdate` callbacks for `mcp__` tools and forwards inputs and results to `McpAppsService`.
- The renderer feature is `src/renderer/features/mcp-apps/`. `McpToolBlock` always renders `McpToolView` and additionally renders `McpAppHost` when the tool has a UI resource and the server isn't disabled.
- Apps run in a double-iframe sandbox. The outer iframe loads a generated proxy with `sandbox="allow-scripts allow-same-origin ..."` and the inner iframe enforces a server-declared CSP meta tag.
- `useAppBridge` manages the host side of `@modelcontextprotocol/ext-apps`. App requests route to tRPC mutations. Host context (theme, display mode, dimensions) flows back via the bridge.
- Users can disable MCP Apps per server via `settingsStore.mcpAppsDisabledServers`.

## Other packages

- **`packages/agent`** TypeScript agent framework wrapping `@anthropic-ai/claude-agent-sdk`. Owns the ACP connection, worktree management, PostHog API integration, task execution and session management. The cloud agent server is exported via `@posthog/agent/server`.
- **`packages/git`** Platform-agnostic git saga operations (clone, branch, commit, push, stash, worktree, patch, publish), a read-write lock and a gh CLI client. Depends only on `@posthog/shared` and `@posthog/platform`.
- **`packages/enricher`** AST-based PostHog flag call detection and source enrichment across languages. No workspace dependencies. Reusable from any host (Electron, mobile, CI, server).
- **`packages/platform`** Interface-only. Declares the host capabilities a service can depend on (`ISecureStorage`, `IClipboard`, `IDialog`, `INotifier`, `IUpdater`, `IShell`, `IFileSystem`, etc.). No implementations. Per-target adapters fulfill the interfaces. Electron adapters live in `apps/code/src/main/platform-adapters/`. Future React Native and web adapters will live in their respective apps. Domain packages and main services depend on these interfaces, never on Electron APIs directly.
- **`packages/electron-trpc`** tRPC-over-Electron-IPC bridge.
- **`packages/shared`** Zero-dependency shared utilities (Saga pattern for atomic multi-step operations with automatic rollback, cloud-prompt encoding). Built with tsup, outputs ESM.
- **`apps/cli`** Thin shell over the external `@posthog/cli` npm package. Command files handle argument parsing and output formatting only. No business logic. No data transformation. No tree building.
