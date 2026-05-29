import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkMutate,
  getStatusQuery,
  installMutate,
  isEnabledQuery,
  subscriptions,
  toast,
} = vi.hoisted(() => ({
  checkMutate: vi.fn(),
  getStatusQuery: vi.fn(),
  installMutate: vi.fn(),
  isEnabledQuery: vi.fn(),
  subscriptions: {
    onStatus: null as
      | null
      | ((status: {
          checking: boolean;
          downloading?: boolean;
          upToDate?: boolean;
          updateReady?: boolean;
          version?: string;
          error?: string;
        }) => void),
    onReady: null as null | ((data: { version: string | null }) => void),
    onCheckFromMenu: null as null | (() => void),
  },
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {
    updates: {
      isEnabled: { query: isEnabledQuery },
      getStatus: { query: getStatusQuery },
      check: { mutate: checkMutate },
      install: { mutate: installMutate },
      onStatus: {
        subscribe: vi.fn((_input, handlers) => {
          subscriptions.onStatus = handlers.onData;
          return { unsubscribe: vi.fn() };
        }),
      },
      onReady: {
        subscribe: vi.fn((_input, handlers) => {
          subscriptions.onReady = handlers.onData;
          return { unsubscribe: vi.fn() };
        }),
      },
      onCheckFromMenu: {
        subscribe: vi.fn((_input, handlers) => {
          subscriptions.onCheckFromMenu = handlers.onData;
          return { unsubscribe: vi.fn() };
        }),
      },
    },
  },
}));

vi.mock("@utils/logger", () => ({
  logger: {
    scope: () => ({
      error: vi.fn(),
    }),
  },
}));

vi.mock("@utils/toast", () => ({
  toast,
}));

import { initializeUpdateStore, useUpdateStore } from "./updateStore";

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("updateStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscriptions.onStatus = null;
    subscriptions.onReady = null;
    subscriptions.onCheckFromMenu = null;
    isEnabledQuery.mockResolvedValue({ enabled: true });
    getStatusQuery.mockResolvedValue({ checking: false });
    checkMutate.mockResolvedValue({ success: true });
    installMutate.mockResolvedValue({ installed: true });
    useUpdateStore.setState({
      status: "idle",
      version: null,
      isEnabled: false,
    });
  });

  it("hydrates an already-ready update from the main status snapshot", async () => {
    getStatusQuery.mockResolvedValue({
      checking: false,
      updateReady: true,
      version: "v2.0.0",
    });

    const dispose = initializeUpdateStore();
    await flushPromises();

    expect(getStatusQuery).toHaveBeenCalled();
    expect(useUpdateStore.getState()).toMatchObject({
      isEnabled: true,
      status: "ready",
      version: "v2.0.0",
    });

    dispose();
  });

  it("surfaces an already-staged update from a menu check replay", async () => {
    const dispose = initializeUpdateStore();
    await flushPromises();

    subscriptions.onCheckFromMenu?.();
    await flushPromises();

    expect(checkMutate).toHaveBeenCalled();

    subscriptions.onReady?.({ version: "v2.0.0" });
    expect(useUpdateStore.getState()).toMatchObject({
      status: "ready",
      version: "v2.0.0",
    });

    subscriptions.onStatus?.({ checking: false });
    dispose();
  });
});
