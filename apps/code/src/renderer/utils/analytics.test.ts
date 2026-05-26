import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPosthog = {
  init: vi.fn(),
  register: vi.fn(),
  onFeatureFlags: vi.fn(),
  isFeatureEnabled: vi.fn(),
  startSessionRecording: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  group: vi.fn(),
  reset: vi.fn(),
  captureException: vi.fn(),
  reloadFeatureFlags: vi.fn(),
};

vi.mock("posthog-js/dist/module.full.no-external", () => ({
  default: mockPosthog,
}));

vi.mock("posthog-js/dist/posthog-recorder", () => ({}));

async function loadAnalytics() {
  vi.resetModules();
  return await import("./analytics");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_POSTHOG_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("onFeatureFlagsLoaded", () => {
  it("delivers pre-init subscribers when init runs", async () => {
    const { initializePostHog, onFeatureFlagsLoaded } = await loadAnalytics();

    const cb = vi.fn();
    onFeatureFlagsLoaded(cb);

    expect(mockPosthog.onFeatureFlags).not.toHaveBeenCalled();

    initializePostHog();

    expect(mockPosthog.onFeatureFlags).toHaveBeenCalledTimes(1);
    expect(mockPosthog.onFeatureFlags).toHaveBeenCalledWith(cb);
  });

  it("does not register a buffered listener that unsubscribed before init", async () => {
    const { initializePostHog, onFeatureFlagsLoaded } = await loadAnalytics();

    const cb = vi.fn();
    const off = onFeatureFlagsLoaded(cb);
    off();

    initializePostHog();

    expect(mockPosthog.onFeatureFlags).not.toHaveBeenCalled();
  });

  it("propagates unsubscribe to PostHog when called after init", async () => {
    const realUnsub = vi.fn();
    mockPosthog.onFeatureFlags.mockReturnValue(realUnsub);

    const { initializePostHog, onFeatureFlagsLoaded } = await loadAnalytics();

    const off = onFeatureFlagsLoaded(vi.fn());
    initializePostHog();
    off();

    expect(realUnsub).toHaveBeenCalledTimes(1);
  });

  it("routes post-init subscribers directly to PostHog", async () => {
    const realUnsub = vi.fn();
    mockPosthog.onFeatureFlags.mockReturnValue(realUnsub);

    const { initializePostHog, onFeatureFlagsLoaded } = await loadAnalytics();
    initializePostHog();

    const cb = vi.fn();
    const off = onFeatureFlagsLoaded(cb);

    expect(mockPosthog.onFeatureFlags).toHaveBeenCalledWith(cb);

    off();
    expect(realUnsub).toHaveBeenCalledTimes(1);
  });
});

describe("registerAppVersion", () => {
  it("registers app_version as a super property after init", async () => {
    const { initializePostHog, registerAppVersion } = await loadAnalytics();

    initializePostHog();
    registerAppVersion("1.2.3");

    expect(mockPosthog.register).toHaveBeenCalledWith({ app_version: "1.2.3" });
  });

  it("does nothing before init", async () => {
    const { registerAppVersion } = await loadAnalytics();

    registerAppVersion("1.2.3");

    expect(mockPosthog.register).not.toHaveBeenCalled();
  });

  it("re-registers app_version after resetUser clears super properties", async () => {
    const { initializePostHog, registerAppVersion, resetUser } =
      await loadAnalytics();

    initializePostHog();
    registerAppVersion("1.2.3");

    resetUser();

    expect(mockPosthog.reset).toHaveBeenCalledTimes(1);
    expect(mockPosthog.register).toHaveBeenLastCalledWith({
      team: "posthog-code",
      app_version: "1.2.3",
    });
  });
});

describe("initializePostHog", () => {
  it("is idempotent across repeat calls", async () => {
    const { initializePostHog } = await loadAnalytics();

    initializePostHog();
    initializePostHog();

    expect(mockPosthog.init).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no API key is set", async () => {
    vi.stubEnv("VITE_POSTHOG_API_KEY", "");
    const { initializePostHog, onFeatureFlagsLoaded } = await loadAnalytics();

    const cb = vi.fn();
    onFeatureFlagsLoaded(cb);
    initializePostHog();

    expect(mockPosthog.init).not.toHaveBeenCalled();
    expect(mockPosthog.onFeatureFlags).not.toHaveBeenCalled();
  });
});
