import { getSessionService } from "@features/sessions/service/service";
import { useConnectivityStore } from "@stores/connectivityStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeConnectivityRecovery } from "./connectivityRecovery";

vi.mock("@features/sessions/service/service", () => ({
  getSessionService: vi.fn(),
}));

// The connectivity store constructs the tRPC client at import; stub it since
// these tests drive the store directly and never hit the network.
vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {},
}));

describe("initializeConnectivityRecovery", () => {
  let retry: ReturnType<typeof vi.fn>;
  let markDropped: ReturnType<typeof vi.fn>;
  let clearGiveup: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useConnectivityStore.setState({ isOnline: true });
    retry = vi.fn();
    markDropped = vi.fn();
    clearGiveup = vi.fn();
    vi.mocked(getSessionService).mockReturnValue({
      retryUnhealthyCloudSessions: retry,
      markInflightTurnsNetworkDropped: markDropped,
      clearOfflineTurnGiveupTimers: clearGiveup,
    } as unknown as ReturnType<typeof getSessionService>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries unhealthy cloud sessions after the connection is restored", () => {
    const dispose = initializeConnectivityRecovery();

    useConnectivityStore.getState().setOnline(false);
    useConnectivityStore.getState().setOnline(true);
    vi.advanceTimersByTime(2_000);

    expect(retry).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("flags in-flight turns as network-dropped when the connection drops", () => {
    const dispose = initializeConnectivityRecovery();

    useConnectivityStore.getState().setOnline(false);

    expect(markDropped).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("clears offline give-up timers immediately on reconnect so turns resume", () => {
    const dispose = initializeConnectivityRecovery();

    useConnectivityStore.getState().setOnline(false);
    useConnectivityStore.getState().setOnline(true);

    // Cleared right away — not gated behind the reconnect debounce.
    expect(clearGiveup).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("does not retry when connectivity never dropped", () => {
    const dispose = initializeConnectivityRecovery();

    // Re-asserting the same online state is not a transition.
    useConnectivityStore.getState().setOnline(true);
    vi.advanceTimersByTime(2_000);

    expect(retry).not.toHaveBeenCalled();
    dispose();
  });

  it("does not retry if the connection flaps back offline before stabilizing", () => {
    const dispose = initializeConnectivityRecovery();

    useConnectivityStore.getState().setOnline(false);
    useConnectivityStore.getState().setOnline(true);
    vi.advanceTimersByTime(500);
    // Drops again before the debounce window elapses.
    useConnectivityStore.getState().setOnline(false);
    vi.advanceTimersByTime(2_000);

    expect(retry).not.toHaveBeenCalled();
    dispose();
  });
});
