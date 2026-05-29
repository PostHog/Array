# Testing

## Commands

- `pnpm test`: run unit tests across packages.
- `pnpm --filter code test`: run desktop app unit tests.
- `pnpm test:e2e`: run Playwright E2E tests.
- `pnpm --filter <pkg> test`: run tests for one package.

## Test Types

Use unit tests when the code can run without Electron.

Unit-test:

- core services
- UI services
- Zustand stores
- pure utilities
- data transforms
- validators
- business decisions

Use E2E tests for behavior that needs the full app.

E2E-test:

- auth flows
- task creation
- workspace setup
- IPC behavior
- real Electron APIs
- multi-step user workflows
- regression coverage for reported app bugs

Rule: if Electron is not required, write a unit test.

## File Location

- Unit tests colocate with source as `.test.ts` or `.test.tsx`.
- E2E tests live in `tests/e2e/`.
- Package test setup files live at `<pkg>/src/test/setup.ts`.
- Feature-specific helpers colocate with the feature.

Avoid central test utility folders unless the helper is broadly reused across packages.

## Service Tests

Construct services with faked injected dependencies. Do not use the container unless the test is specifically about DI wiring.

```ts
const workspace = {
  focus: {
    enable: vi.fn().mockResolvedValue(ok),
  },
};

const git = {
  getCurrentBranch: vi.fn().mockResolvedValue("main"),
};

const service = new FocusService(
  git as unknown as IGitService,
  workspace as unknown as FocusWorkspaceClient
);

await service.enableFocus(input);

expect(workspace.focus.enable).toHaveBeenCalledWith(expectedInput);
```

Test the service decision, not the transport.

## Store Tests

Reset store state before each test. Clear storage when persistence is involved.

```ts
describe("store", () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ open: false, width: 256 });
  });

  it("updates state", () => {
    useStore.getState().toggle();

    expect(useStore.getState().open).toBe(true);
  });

  it("persists selected fields", () => {
    useStore.getState().setOpen(true);

    const persisted = localStorage.getItem("store-key");

    expect(JSON.parse(persisted ?? "{}").state).toEqual({ open: true });
  });
});
```

## Mocking

Hoist mocks for modules that must be mocked before import evaluation.

```ts
const mockPty = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node-pty", () => mockPty);
```

Use simple module mocks for direct dependencies.

```ts
vi.mock("@utils/analytics", () => ({
  track: vi.fn(),
}));
```

Stub globals explicitly.

```ts
const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);
mockFetch.mockResolvedValueOnce(ok());
```

## UI Tests

Prefer explicit props and fake services over app-wide setup. Test rendered behavior and user-observable state.

For components using DI:

- pass props directly when possible
- fake service interfaces
- bind only the services required by the component
- avoid running the full boot unless the test covers boot behavior

## E2E Tests

Use Playwright for flows that require the running app or Electron APIs.

Keep E2E tests focused:

- one user journey per test
- stable selectors
- no arbitrary sleeps
- assert visible outcomes
- capture regression conditions explicitly

## Boundary Checks

After touching `@posthog/platform`, rebuild or typecheck its `dist/` before relying on downstream typechecks.

After touching `packages/core`, run:

```bash
biome lint packages/core
```

Expected result: zero `noRestrictedImports` violations.
