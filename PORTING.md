# PORTING.md — thin UI, thick core

The playbook for porting a feature so its **business logic is portable** (runs on
web/mobile, not just Electron) and its **UI is a thin shell**. Patterns validated on
`connectivity` and matched against the existing `git` / `focus` / `sessions` / `billing` code.

If anything contradicts [AGENTS.md](./AGENTS.md) / [CLAUDE.md](./CLAUDE.md), those win on
layering. For multi-agent coordination use [REFACTOR.md](./REFACTOR.md) + `REFACTOR_SLICES.json`.

---

## Port a feature by answering three questions

Most mistakes come from skipping these or conflating them (we built `connectivity` ~3 ways
before getting it right). Answer them in order.

### Q1 — Where does the data / host access come from? *(picks the wiring)*

- **a. ws-server backend** — git, fs, process, the connectivity probe.
  → A **core service that injects the workspace client** and calls ws-server; bound in the
  **main process**, reached from the renderer over tRPC. *(see `git`, `focus`)*
- **b. PostHog cloud API** — tasks, billing, projects, anything on the Django API.
  → A **core service / functions using `@posthog/api-client`**. Portable anywhere there's an
  HTTP client; no host capability needed. *(see `billing`, `projects`)*
- **c. Client-local host capability** — clipboard, dialog, OS notifications, `navigator.onLine`.
  → A **`@posthog/platform` interface + per-host adapter**. *(see `clipboard`)*

> ws-client injection (a) is **main-process only** — the renderer's ws-client is built inside
> React (`Providers.tsx`), connection-dependent, and can drop. Don't inject it into a
> renderer-resident service.

### Q2 — Is there real logic? → **make a service.** *(this is the "thick core")*

**The logic of a feature lives in a service — an `@injectable` class in `@posthog/core`.**
Not in components, not in hooks, not in stores.

A service:
- holds business logic — orchestration, retries, dedup, rules, transforms, sagas;
- **injects** its dependencies (workspace client, `api-client`, platform interfaces, other services);
- has **no React, no JSX**; it may read/write a store but **is not** a store;
- is the thing web/mobile reuse unchanged.

When **not** to make one: a feature with no real logic — a value streamed from the backend
into a store, a one-line passthrough — does **not** get a service. `connectivity` is one
boolean fed by a subscription, so it's a store + host glue, **no service**. Don't manufacture a
`FooService` for a 1-field feature; that was the connectivity over-engineering.

> Rule of thumb: if you can't name an algorithm/decision the service makes, you don't need one.

### Q3 — Where does the state live? → **a store, on the correct side.**

A store is a **state cell** (zustand): holds state, **no logic / async / `trpcClient`**.

- **Domain state of record** — a *fact* business logic reads (`isOnline` drives `sessions`
  retries) → **`@posthog/core`, `zustand/vanilla`**. Fed by a service or host glue; observed
  by UI and core.
- **Pure view state** — scroll position, open panel, draft text, selection → **`@posthog/ui`,
  `zustand`** (`create`).

Components read via selectors; a hook re-bundles for ergonomics (`createSelectors` →
`store.use.field()`).

---

## Layers

| Package | Owns | Never contains |
|---|---|---|
| `@posthog/platform` | Host-capability **interfaces** + tokens. Host-neutral. | Implementations, Node, DOM, tRPC, Electron |
| `@posthog/workspace-server` | Node backend services + their tRPC. | UI, core, Electron |
| `@posthog/api-client` | PostHog/Django HTTP client. | UI, Node-only host syscalls |
| `@posthog/core` | Portable **services** + domain types + **domain stores**. Injects workspace client / api-client / platform interfaces. | React, `trpcClient`, Node syscalls, Electron, host-router types |
| `@posthog/ui` | React glue: components, hooks, contributions, **view-state stores**. | Business logic, `trpcClient`, Node |
| `apps/code` | Electron lifecycle + **platform adapters** + tRPC routers + DI wiring. | Business logic |

`apps/code/src/main/platform-adapters/` — capabilities **main** consumes.
`apps/code/src/renderer/platform-adapters/` — capabilities the **renderer** consumes (wrap `trpcClient`).

---

## Skeletons

### Service (Q2) — the logic, injectable, in core

```ts
// @posthog/core/<feature>/<feature>.ts
@injectable()
export class FeatureService {
  constructor(
    @inject(FEATURE_WORKSPACE_CLIENT) private readonly ws: FeatureWorkspaceClient, // Q1a
    // or @inject(API_CLIENT) private readonly api: PostHogApiClient,               // Q1b
    // or @inject(THING_SERVICE) private readonly thing: IThing,                    // Q1c
  ) {}
  async doThing() { /* orchestration, rules, retries — the actual logic */ }
}
```

### Q1a — ws-server backend (`git` / `focus`)

Core declares a **narrow slice** of the workspace client and injects it; bound in main with the
real client; exposed to the renderer via a host-router tRPC router.

```ts
// @posthog/core/<feature>/identifiers.ts
import type { WorkspaceClient } from "@posthog/workspace-client/client";
export interface FeatureWorkspaceClient { feature: WorkspaceClient["feature"]; }
export const FEATURE_SERVICE = Symbol.for("posthog.core.featureService");
export const FEATURE_WORKSPACE_CLIENT = Symbol.for("posthog.core.featureWorkspaceClient");
```
```ts
// apps/code/src/main/index.ts  (composition — the real client; cloud client on web)
container.bind(MAIN_TOKENS.FeatureService).toConstantValue(new FeatureService(workspaceClient));
container.bind(FEATURE_SERVICE).toService(MAIN_TOKENS.FeatureService);
```

### Q1c — client-local capability (`clipboard`)

```ts
// @posthog/platform/src/<cap>.ts        host-neutral: onDidChange(listener): () => void
export interface IThing { read(): Promise<T>; onDidChange(l: (v: T) => void): () => void; }
export const THING_SERVICE = Symbol.for("posthog.platform.thing");
```
```ts
// apps/code/src/{main,renderer}/platform-adapters/<cap>.ts
container.bind(THING_SERVICE).toConstantValue(electronImpl);
```
**Never** put tRPC `{ onData, onError }` / `{ unsubscribe }` shapes in the interface — translate
them in the adapter. Platform ships built `dist/`: a new file needs `src/<cap>.ts` + a
`tsup.config.ts` entry + a `package.json` export + `pnpm --filter @posthog/platform build`.

### Streamed state, no service (`connectivity`) — Q1a data + Q3 domain store

```ts
// @posthog/core/<feature>/<feature>Store.ts   (domain fact → core, vanilla)
import { createStore } from "zustand/vanilla";
export const featureStore = createStore<{ value: T; setValue: (v: T) => void }>((set) => ({
  value: initial, setValue: (value) => set({ value }),
}));
export const getValue = () => featureStore.getState().value;
```
```ts
// apps/code/src/renderer/platform-adapters/<feature>.ts   (host glue — the ONLY trpcClient touch)
import { featureStore } from "@posthog/core/<feature>/<feature>Store";
import { trpcClient } from "@renderer/trpc/client";
const { setValue } = featureStore.getState();
void trpcClient.feature.get.query().then(setValue).catch(() => undefined);
trpcClient.feature.onChange.subscribe(undefined, { onData: setValue });
```
```ts
// @posthog/ui/hooks/useFeature.ts   (read via auto-selectors)
import { featureStore } from "@posthog/core/<feature>/<feature>Store";
import { createSelectors } from "./createSelectors";
const feature = createSelectors(featureStore);
export const useFeature = () => ({ value: feature.use.value() });
```
A core consumer (e.g. `sessions`' `getIsOnline`) imports the store's `getValue` getter directly.

---

## DI

- **Plain Inversify.** Interface + `Symbol.for` token in the owning package; constructor `@inject(TOKEN)`; bind in the feature's `.module.ts` (ui/core) or `index.ts` composition (main).
- **Never call them "ports."** These are **interfaces** — name them as such (`IThing` / `FeatureWorkspaceClient`), not `FooPort` / `FOO_PORT` / `ports.ts`. The existing `*_PORT` tokens, `*Port` types, and `ports.ts` files are legacy; new code uses "interface", and rename old ones when you touch them.
- **Do NOT use `@inversifyjs/binding-decorators` (`@provide`) or `@inversifyjs/strongly-typed`.** Tried both on `connectivity`, removed them — `@provide`'s side-effect-import is a footgun, `strongly-typed`'s binding-map is pure tax.
- **`resolveService` is a service-locator smell.** Constructor-inject in services; `useService(TOKEN)` at the React boundary only. `resolveService` is tolerated only in host composition seams (`apps/`).

---

## Anti-patterns (removed this session — do not reintroduce)

| Anti-pattern | Fix |
|---|---|
| A platform interface for **backend** data | Q1a/Q1b — workspace client / api-client |
| A **service** for a trivial passthrough (1 field, no logic) | Q3 store + host glue, no service |
| A **domain** store in `@posthog/ui` | Domain facts → core (`zustand/vanilla`) |
| A renderer-resident core service injecting the workspace client | ws-client is React-bound/fragile; stream into a core store |
| Bespoke `IFeatureClient` that 1:1 wraps `trpcClient.x` | Use the real client / `HOST_TRPC_CLIENT` |
| Per-feature `FeatureLogger` interface + token | Generic `logger.scope` (UI) / shared logger (core) |
| `@inversifyjs/strongly-typed` + a `Deps` map | `@inject(TOKEN)` |
| Separate `IFeatureService` interface for one impl | Inject the concrete class |
| `{ onData, onError }` / `{ unsubscribe }` in a platform interface | `onDidChange(listener): () => void` |
| Logic / async in a Zustand store action | A service (Q2); the store does only `set` |
| `trpcClient` imported in `@posthog/ui` | host glue in `apps/` feeds the store |
| Adapter in a `features/<x>/` folder | `apps/code/.../platform-adapters/<x>.ts` |
| A bridge mirroring a service that mirrors another service | collapse it; each consumer caches what it needs |

---

## Validation gates

```sh
pnpm typecheck                                    # all packages green
pnpm exec biome lint packages/core/src/<feature>  # core purity: zero noRestrictedImports
pnpm --filter <pkg> exec vitest run src/<feature>  # unit tests (services test with fake deps)
pnpm biome check --write <touched paths>          # format
```
- Touched a `@posthog/platform` interface (Q1c)? **rebuild platform dist** or typecheck lies.
- Moved a service/store to core? the **core purity gate** must be clean (no Node/Electron/React/`trpcClient`).
- Repoint test mocks to the new import specifier (a shim hides the break from typecheck).
- Renderer `vite build` is the cheap runtime smoke when DI/boot wiring changed.

---

## Reference: `connectivity` (streamed domain state, no service)

```
@posthog/core/connectivity/connectivityStore.ts          domain store { isOnline } + getIsOnline (vanilla)
@posthog/ui/features/connectivity/connectivityToast.ts   subscribes the core store → offline toast
@posthog/ui/hooks/useConnectivity.ts                     reads the core store via createSelectors
apps/code/src/renderer/platform-adapters/connectivity.ts host glue: trpc subscription → core store + toast
```
`sessions` imports `getIsOnline` from the core store. The probe lives in `workspace-server`'s
connectivity service, served over tRPC. No core service (nothing to orchestrate), no platform
interface, no per-feature DI — the store *is* in core because `isOnline` is a domain fact.
