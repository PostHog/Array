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
      menuCheckPending: false,
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

  it("hydrates an installing update so the renderer keeps the restart spinner", async () => {
    getStatusQuery.mockResolvedValue({
      checking: false,
      updateReady: true,
      installing: true,
      version: "v2.0.0",
    });

    const dispose = initializeUpdateStore();
    await flushPromises();

    expect(useUpdateStore.getState()).toMatchObject({
      status: "installing",
      version: "v2.0.0",
    });

    dispose();
  });

  it("does not reset a ready update when a stale upToDate status arrives", async () => {
    getStatusQuery.mockResolvedValue({
      checking: false,
      updateReady: true,
      version: "v2.0.0",
    });

    const dispose = initializeUpdateStore();
    await flushPromises();

    subscriptions.onStatus?.({ checking: false, upToDate: true });

    expect(useUpdateStore.getState().status).toBe("ready");
    dispose();
  });

  it("shows the success toast when a menu check resolves with upToDate", async () => {
    const dispose = initializeUpdateStore();
    await flushPromises();

    subscriptions.onCheckFromMenu?.();
    await flushPromises();
    expect(useUpdateStore.getState().menuCheckPending).toBe(true);

    subscriptions.onStatus?.({ checking: false, upToDate: true });

    expect(toast.success).toHaveBeenCalledWith("You're on the latest version");
    expect(useUpdateStore.getState().menuCheckPending).toBe(false);
    dispose();
  });

  it("clears the menu-check flag on disabled errors and shows the error toast", async () => {
    checkMutate.mockResolvedValue({
      success: false,
      errorCode: "disabled",
      errorMessage: "Updates only available in packaged builds",
    });

    const dispose = initializeUpdateStore();
    await flushPromises();

    subscriptions.onCheckFromMenu?.();
    await flushPromises();

    expect(useUpdateStore.getState().menuCheckPending).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      "Updates only available in packaged builds",
    );
    dispose();
  });

  it("keeps the menu-check flag when an in-flight check is already running", async () => {
    checkMutate.mockResolvedValue({
      success: false,
      errorCode: "already_checking",
    });

    const dispose = initializeUpdateStore();
    await flushPromises();

    subscriptions.onCheckFromMenu?.();
    await flushPromises();

    expect(useUpdateStore.getState().menuCheckPending).toBe(true);
    dispose();
  });
});
