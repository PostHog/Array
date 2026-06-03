# Testing

Detailed testing reference. Top-level rule of thumb lives in [AGENTS.md](../AGENTS.md).

## Commands

- `pnpm test` Run unit tests across all packages
- `pnpm --filter code test` Run code unit tests only
- `pnpm test:e2e` Run Playwright E2E tests

## When to write unit tests vs E2E tests

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

## Test file location

Tests are colocated with source code using `.test.ts` or `.test.tsx` extension. E2E tests live in `tests/e2e/`.

## Store testing

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

## Mocking patterns

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

## Test helpers

Test utilities are in `src/test/`:
- `setup.ts` Global test setup with localStorage mock
- `utils.tsx` `renderWithProviders()` for component tests
- `fixtures.ts` Mock data factories
- `panelTestHelpers.ts` Domain-specific assertions
