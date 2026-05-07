# PostHog Code Development Guide

## Project Structure

- Monorepo with pnpm workspaces and turbo
- `apps/code` - PostHog Code Electron desktop app (React + Vite)
- `apps/cli` - CLI tool (thin wrapper around @posthog/core)
- `apps/mobile` - React Native mobile app (Expo)
- `packages/agent` - TypeScript agent framework wrapping Claude Agent SDK
- `packages/core` - Shared business logic for jj/GitHub operations
- `packages/electron-trpc` - Custom tRPC package for Electron IPC
- `packages/shared` - Shared utilities (Saga pattern, etc.) used across packages

## Commands

- `pnpm install` - Install all dependencies
- `pnpm dev` - Run both agent (watch) and code app via phrocs
- `pnpm dev:mprocs` - Run both agent (watch) and code app via mprocs
- `pnpm dev:agent` - Run agent package in watch mode only
- `pnpm dev:code` - Run code desktop app only
- `pnpm build` - Build all packages (turbo)
- `pnpm typecheck` - Type check all packages
- `pnpm lint` - Lint and auto-fix with biome
- `pnpm format` - Format with biome
- `pnpm test` - Run tests across all packages

### Code App Specific

- `pnpm --filter code test` - Run vitest tests
- `pnpm --filter code typecheck` - Type check code app
- `pnpm --filter code package` - Package electron app
- `pnpm --filter code make` - Make distributable

### Agent Package Specific

- `pnpm --filter agent build` - Build agent with tsup
- `pnpm --filter agent dev` - Watch mode build
- `pnpm --filter agent typecheck` - Type check agent

### Shared Package Specific

- `pnpm --filter @posthog/shared build` - Build shared with tsup
- `pnpm --filter @posthog/shared dev` - Watch mode build
- `pnpm --filter @posthog/shared typecheck` - Type check shared

## Code Style

- Prefer writing our own solution over adding external packages when the fix is simple
- Keep functions focused with single responsibility
- Biome for linting and formatting (not ESLint/Prettier)
- 2-space indentation, double quotes
- No `console.*` in source - use logger instead (logger files exempt)
- Path aliases required in renderer code - no relative imports
  - `@features/*`, `@components/*`, `@stores/*`, `@hooks/*`, `@utils/*`, `@renderer/*`, `@shared/*`, `@api/*`
- Main process path aliases: `@main/*`, `@api/*`, `@shared/*`
- TypeScript strict mode enabled
- Tailwind CSS classes should be sorted (biome `useSortedClasses` rule)

### Services Over Hooks for Business Logic

Put data-fetching logic and derivation in main process services, not renderer hooks. Hooks should be thin wrappers around a single tRPC query. If a hook orchestrates multiple queries and derives a result, that logic belongs in a service exposed via tRPC so it can be reused from both the main process and the renderer.

### Small Focused Components

Extract distinct UI concerns into their own components instead of building long inline ternary chains or conditional blocks. If a section of JSX handles its own logic (e.g. icon selection based on state), pull it into a named component next to where it's used. Keep render functions short and scannable.

### Async Cleanup Ordering

When tearing down async operations that use an AbortController, always abort the controller **before** awaiting any cleanup that depends on it. Otherwise you get a deadlock: the cleanup waits for the operation to stop, but the operation won't stop until the abort signal fires.

```typescript
// WRONG - deadlocks if interrupt() waits for the operation to finish
await this.interrupt();          // hangs: waits for query to stop
this.abortController.abort();    // never reached

// RIGHT - abort first so the operation can actually stop
this.abortController.abort();    // cancels in-flight HTTP requests
await this.interrupt();          // resolves because the query was aborted
```

### Avoid Barrel Files

- Do not make use of index.ts

Barrel files:

- Break tree-shaking
- Create circular dependency risks
- Hide the true source of imports
- Make refactoring harder

Import directly from source files instead.

## Architecture

See [ARCHITECTURE.md](./apps/code/ARCHITECTURE.md) for detailed patterns (DI, services, tRPC, state management).

### Electron App (apps/code)

- **Main process** (`src/main/`) - Services own all business logic, orchestration, polling, data fetching, and system I/O
- **Renderer process** (`src/renderer/`) - React app with Zustand stores holding pure UI state and thin action wrappers over tRPC
- **IPC**: tRPC over Electron IPC (type-safe via @posthog/electron-trpc)
- **DI**: InversifyJS in both processes (`src/main/di/`, `src/renderer/di/`)
- **Testing**: Vitest with React Testing Library

### Agent Package (packages/agent)

- Wraps `@anthropic-ai/claude-agent-sdk`
- Git worktree management in `worktree-manager.ts`
- PostHog API integration in `posthog-api.ts`
- Task execution and session management

### CLI Package (packages/cli)

- **Dumb shell, imperative core**: CLI commands should be thin wrappers that call `@posthog/core`
- All business logic belongs in `@posthog/core`, not in CLI command files
- CLI only handles: argument parsing, calling core, formatting output
- No data transformation, tree building, or complex logic in CLI

### Core Package (packages/core)

- Shared business logic for jj/GitHub operations

### Shared Package (packages/shared)

- Zero-dependency shared utilities used across packages
- Saga pattern for atomic multi-step operations with automatic rollback
- Built with tsup, outputs ESM

## Agent Integration Guidelines

- **No rawInput**: Don't use Claude Code SDK's `rawInput` - only use Zod validated meta fields. This keeps us agent agnostic and gives us a maintainable, extensible format for logs.
- **Use ACP SDK types**: Don't roll your own types for things available in the ACP SDK. Import types directly from `@anthropic-ai/claude-agent-sdk` TypeScript SDK.
- **Permissions via tool calls**: If something requires user input/approval, implement it through a tool call with a permission instead of custom methods + notifications. Avoid patterns like `_array/permission_request`.

## Key Libraries

- React 19, Radix UI Themes, Tailwind CSS
- TanStack Query for data fetching
- xterm.js for terminal emulation
- CodeMirror for code editing
- Tiptap for rich text
- Zod for schema validation
- InversifyJS for dependency injection
- Sonner for toast notifications

## Code Patterns

### React Components

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

Always reach for Tailwind utility classes first. The codebase uses Tailwind v4
with CSS variables from Radix Themes (e.g. `--gray-12`, `--space-3`,
`--radius-2`); use Tailwind v4's CSS-var shorthand to bridge them — `text-(--gray-12)`,
`bg-(--gray-2)`, `rounded-(--radius-2)`, `border-(--gray-5)`. Use arbitrary values
(`text-[13px]`, `pl-[18px]`) when the design token doesn't have a named match.

Inline `style={{}}` is acceptable in three cases only:

1. **Genuinely dynamic values** computed at runtime that can't be a class —
   e.g. `style={{ width: `${pxFromHook}px` }}`, `style={{ transform: `translateY(${y}px)` }}`,
   pixel positions from measurement, data-driven colors that don't fit a fixed palette.
2. **Library configuration** passed to non-React libraries (CodeMirror's
   `EditorView.theme(...)`, xterm.js options, etc.).
3. **CSS variables set from JS** that downstream classes consume —
   `style={{ "--row-color": item.color }}` paired with `className="bg-(--row-color)"`.

Do NOT use inline `style` for:

- Color tokens (use `text-(--gray-12)`, `bg-(--gray-2)`, `border-(--gray-5)`)
- Spacing (use `p-3`, `mt-2`, `pl-4`, `gap-2`) — Radix `--space-N` matches Tailwind's
  spacing scale 1:1 for `--space-1`..`--space-4`; `--space-5` = `6`, `--space-6` = `8`, etc.
- Layout primitives (`shrink-0`, `min-w-0`, `flex-1`, `overflow-y-auto`, `w-full`, `h-full`)
- Borders (`border border-(--gray-5)`), radii (`rounded-(--radius-2)` or `rounded-full`)
- Cursors (`cursor-pointer`, `cursor-col-resize`)
- Opacity (`opacity-50`), text-align, text-transform (`uppercase`), white-space, word-break
- Position (`absolute`, `relative`, `fixed`), z-index (`z-10`, `z-[201]`), inset (`inset-0`)
- Animations that map to a Tailwind utility (`animate-spin`)
- Conditional values that can be `className={cond ? "x" : "y"}` or
  `className={\`base-classes ${cond ? "active-classes" : "inactive-classes"}\`}`

Default line-heights have been tightened (`text-sm` ships with etc.)
in [apps/code/src/renderer/styles/globals.css](./apps/code/src/renderer/styles/globals.css).
Don't add a `leading-*` class for body text unless you specifically want a non-default
line-height. For arbitrary sizes (`text-[13px]`), pair with `leading-snug` for body
text or `leading-tight` for titles.

When writing a custom React component that wraps a styled element, accept BOTH
`className?: string` and `style?: React.CSSProperties` props and merge the
`className` into the inner element's classes (e.g. ``className={`base-classes ${className ?? ""}`}``).
This lets call sites override styling via Tailwind without forcing inline `style`.

### Store / Service Boundary

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
|  Service         |                  | - Business logic |
|                  |                  +------------------+
| - Cross-store    |
|   coordination   |
| - Client-side    |
|   state machines |
+------------------+
```

**Renderer stores own:**
- Pure UI state (open/closed, selected item, scroll position)
- Cached data from subscriptions
- Message queues and event buffers
- Permission display state
- Thin action wrappers that call tRPC mutations

**Renderer services own:**
- Coordination between multiple stores
- Client-side-only state machines and logic

**Main process services own:**
- Business logic and orchestration
- Polling loops and background work
- Data fetching, parsing, and transformation
- Connection management and coordination between services

Stores should never contain business logic, orchestration, or data fetching. If a store action does more than update local state or call a single tRPC method, that logic belongs in a service. Services typically live in the main process, but renderer-side services are fine when the logic is purely client-side (e.g., coordinating between stores, managing local-only state machines).

### Zustand Stores

Stores hold pure state with thin actions. Separate state and action interfaces, use persistence middleware where needed:

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

### tRPC Routers (Main Process)

Routers get services from DI container per-request:

```typescript
const getService = () => container.get<GitService>(MAIN_TOKENS.GitService);

export const gitRouter = router({
  detectRepo: publicProcedure
    .input(detectRepoInput)
    .output(detectRepoOutput)
    .query(({ input }) => getService().detectRepo(input.directoryPath)),

  onCloneProgress: publicProcedure.subscription(async function* (opts) {
    const service = getService();
    for await (const data of service.toIterable(GitServiceEvent.CloneProgress, { signal: opts.signal })) {
      yield data;
    }
  }),
});
```

### Services (Main Process)

Services are injectable, own all business logic, and emit events to the renderer via tRPC subscriptions. Orchestration, polling, data fetching, and coordination between services all belong here - not in stores:

```typescript
@injectable()
export class GitService extends TypedEventEmitter<GitServiceEvents> {
  public async detectRepo(directoryPath: string): Promise<DetectRepoResult | null> {
    if (!directoryPath) return null;
    const remoteUrl = await this.getRemoteUrl(directoryPath);
    // ...
  }
}
```

### Custom Hooks

Hooks extract store subscriptions into cleaner interfaces:

```typescript
export function useConnectivity() {
  const isOnline = useConnectivityStore((s) => s.isOnline);
  const check = useConnectivityStore((s) => s.check);
  return { isOnline, check };
}
```

### Logger Usage

Use scoped logger instead of console:

```typescript
const log = logger.scope("navigation-store");

export const useNavigationStore = create<NavigationStore>()(
  persist((set, get) => {
    log.info("Folder path is stale, redirecting...", { folderId: folder.id });
    // ...
  })
);
```

## Testing

### Commands

- `pnpm test` - Run unit tests across all packages
- `pnpm --filter code test` - Run code unit tests only
- `pnpm test:e2e` - Run Playwright E2E tests

### When to Write Unit Tests vs E2E Tests

**Unit tests (Vitest)** - Fast, isolated, run frequently:
- Zustand store logic and state transitions
- Pure utility functions and helpers
- Service methods with mocked dependencies
- Complex business logic in isolation
- Data transformations and validators

**E2E tests (Playwright)** - Slower, test real user flows:
- Critical user journeys (auth, task creation, workspace setup)
- IPC communication between main and renderer
- Features requiring real Electron APIs (file system, shell)
- Multi-step workflows spanning multiple components
- Regression tests for reported bugs

**Rule of thumb**: If it can be tested without Electron running, use a unit test. If it requires the full app context or tests user-facing behavior, use E2E.

### Test File Location

Tests are colocated with source code using `.test.ts` or `.test.tsx` extension. E2E tests live in `tests/e2e/`.

### Store Testing

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

### Mocking Patterns

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

### Test Helpers

Test utilities are in `src/test/`:
- `setup.ts` - Global test setup with localStorage mock
- `utils.tsx` - `renderWithProviders()` for component tests
- `fixtures.ts` - Mock data factories
- `panelTestHelpers.ts` - Domain-specific assertions

## Directory Structure

```
apps/code/src/
├── main/
│   ├── di/                   # InversifyJS container + tokens
│   ├── services/             # Stateless services (git, shell, workspace, etc.)
│   ├── trpc/
│   │   ├── router.ts         # Root router combining all routers
│   │   └── routers/          # Individual routers per service
│   └── lib/logger.ts
├── renderer/
│   ├── di/                   # Renderer DI container
│   ├── features/             # Feature modules (sessions, tasks, terminal, etc.)
│   ├── stores/               # Zustand stores (21+ stores)
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

## Environment Variables

- Copy `.env.example` to `.env`
