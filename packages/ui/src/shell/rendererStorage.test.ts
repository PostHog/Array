import { describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type RendererStorageModule = typeof import("./rendererStorage");

async function importFreshRendererStorage(): Promise<RendererStorageModule> {
  vi.resetModules();
  return await import("./rendererStorage");
}

function fakeBackend(data: Record<string, string>) {
  return {
    getItem: vi.fn(async (key: string) => data[key] ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      data[key] = value;
    }),
    removeItem: vi.fn(async (key: string) => {
      delete data[key];
    }),
  };
}

function jsonStorageOf(module: RendererStorageModule) {
  const storage = module.electronStorage;
  if (!storage) {
    throw new Error("electronStorage is not defined");
  }
  return storage;
}

describe("rendererStorage", () => {
  it("serves reads issued before the host registers its storage", async () => {
    const module = await importFreshRendererStorage();
    const storage = jsonStorageOf(module);

    const read = storage.getItem("settings-storage");

    module.registerRendererStateStorage(
      fakeBackend({
        "settings-storage": JSON.stringify({
          state: { defaultInitialTaskMode: "last_used" },
          version: 0,
        }),
      }),
    );

    await expect(read).resolves.toMatchObject({
      state: { defaultInitialTaskMode: "last_used" },
    });
  });

  it("drops writes racing the initial read, then writes through", async () => {
    const module = await importFreshRendererStorage();
    const storage = jsonStorageOf(module);
    const backend = fakeBackend({
      "settings-storage": JSON.stringify({ state: { mode: "saved" } }),
    });

    const read = storage.getItem("settings-storage");
    const racingWrite = storage.setItem("settings-storage", {
      state: { mode: "default" },
      version: 0,
    });

    module.registerRendererStateStorage(backend);
    await Promise.all([read, racingWrite]);
    expect(backend.setItem).not.toHaveBeenCalled();

    await storage.setItem("settings-storage", {
      state: { mode: "changed" },
      version: 0,
    });
    expect(backend.setItem).toHaveBeenCalledTimes(1);
  });

  it("passes writes through for keys that were never read", async () => {
    const module = await importFreshRendererStorage();
    const storage = jsonStorageOf(module);
    const backend = fakeBackend({});

    const write = storage.setItem("write-only", {
      state: { value: 1 },
      version: 0,
    });
    module.registerRendererStateStorage(backend);
    await write;

    expect(backend.setItem).toHaveBeenCalledTimes(1);
  });

  it("hydrates a store created before the host storage registers", async () => {
    const module = await importFreshRendererStorage();
    const backend = fakeBackend({
      "settings-storage": JSON.stringify({
        state: { defaultInitialTaskMode: "last_used" },
        version: 0,
      }),
    });

    const useStore = create<{ defaultInitialTaskMode: string }>()(
      persist(() => ({ defaultInitialTaskMode: "plan" }), {
        name: "settings-storage",
        storage: jsonStorageOf(module),
      }),
    );

    expect(useStore.getState().defaultInitialTaskMode).toBe("plan");

    module.registerRendererStateStorage(backend);
    await vi.waitFor(() => {
      expect(useStore.getState().defaultInitialTaskMode).toBe("last_used");
    });

    useStore.setState({ defaultInitialTaskMode: "plan" });
    await vi.waitFor(() => {
      expect(backend.setItem).toHaveBeenCalled();
    });
    const persisted = JSON.parse(
      backend.setItem.mock.calls[backend.setItem.mock.calls.length - 1][1],
    );
    expect(persisted.state.defaultInitialTaskMode).toBe("plan");
  });
});
