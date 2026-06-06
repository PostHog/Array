import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForConnectivity } from "./waitForConnectivity";

const mockGetIsOnline = vi.hoisted(() => vi.fn(() => true));
vi.mock("@renderer/stores/connectivityStore", () => ({
  getIsOnline: () => mockGetIsOnline(),
}));

describe("waitForConnectivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves true immediately when already online", async () => {
    mockGetIsOnline.mockReturnValue(true);

    await expect(waitForConnectivity(10_000)).resolves.toBe(true);
  });

  it("resolves true once the connection returns within the window", async () => {
    mockGetIsOnline
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);

    const promise = waitForConnectivity(10_000, 1_000);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(promise).resolves.toBe(true);
  });

  it("resolves false if still offline after the window", async () => {
    mockGetIsOnline.mockReturnValue(false);

    const promise = waitForConnectivity(3_000, 1_000);
    const assertion = expect(promise).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(3_500);

    await assertion;
  });
});
