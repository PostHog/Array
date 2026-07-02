import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPush, whenHydrated, getAllNewestFirst, clear, authState } =
  vi.hoisted(() => ({
    mockPush: vi.fn(),
    whenHydrated: vi.fn(() => Promise.resolve()),
    getAllNewestFirst: vi.fn(
      () => [] as Array<{ key: string; prompt: { promptText: string } }>,
    ),
    clear: vi.fn(),
    authState: { isAuthenticated: true },
  }));

vi.mock("expo-router", () => ({ router: { push: mockPush } }));

vi.mock("@/features/auth", () => ({
  useAuthStore: (selector: (s: typeof authState) => unknown) =>
    selector(authState),
}));

vi.mock("../stores/pendingPromptRecoveryStore", () => ({
  pendingPromptRecoveryStoreApi: { whenHydrated, getAllNewestFirst, clear },
}));

async function mountRecovery() {
  vi.resetModules();
  const { PendingPromptRecovery } = await import("./PendingPromptRecovery");
  await act(async () => {
    create(createElement(PendingPromptRecovery));
    await Promise.resolve();
    await Promise.resolve();
  });
  return PendingPromptRecovery;
}

describe("PendingPromptRecovery", () => {
  beforeEach(() => {
    mockPush.mockReset();
    clear.mockReset();
    whenHydrated.mockReset().mockResolvedValue(undefined);
    getAllNewestFirst.mockReset().mockReturnValue([]);
    authState.isAuthenticated = true;
  });

  it("recovers the newest orphaned prompt into the composer", async () => {
    getAllNewestFirst.mockReturnValue([
      { key: "newest", prompt: { promptText: "Newest prompt" } },
      { key: "older", prompt: { promptText: "Older prompt" } },
    ]);

    await mountRecovery();

    expect(clear).toHaveBeenCalledWith("newest");
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/task",
      params: { prompt: "Newest prompt" },
    });
  });

  it("runs only once even when re-mounted", async () => {
    getAllNewestFirst.mockReturnValue([
      { key: "newest", prompt: { promptText: "Newest prompt" } },
    ]);

    const PendingPromptRecovery = await mountRecovery();
    await act(async () => {
      create(createElement(PendingPromptRecovery));
      await Promise.resolve();
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there is no orphaned prompt", async () => {
    getAllNewestFirst.mockReturnValue([]);

    await mountRecovery();

    expect(mockPush).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it("does not recover until the user is authenticated", async () => {
    authState.isAuthenticated = false;
    getAllNewestFirst.mockReturnValue([
      { key: "newest", prompt: { promptText: "Newest prompt" } },
    ]);

    await mountRecovery();

    expect(mockPush).not.toHaveBeenCalled();
  });
});
