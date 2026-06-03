import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCapture = vi.hoisted(() => vi.fn());
const mockCaptureException = vi.hoisted(() => vi.fn());
const mockIdentify = vi.hoisted(() => vi.fn());
const mockShutdown = vi.hoisted(() => vi.fn());
const MockPostHog = vi.hoisted(() => vi.fn());

vi.mock("posthog-node", () => ({ PostHog: MockPostHog }));

import {
  captureException,
  initializePostHog,
  resetUser,
  shutdownPostHog,
  trackAppEvent,
} from "./posthog-analytics";

describe("posthog-analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockPostHog.mockImplementation(function (this: Record<string, unknown>) {
      this.capture = mockCapture;
      this.captureException = mockCaptureException;
      this.identify = mockIdentify;
      this.shutdown = mockShutdown;
    });
    process.env.VITE_POSTHOG_API_KEY = "test-key";
    resetUser();
    initializePostHog();
  });

  afterEach(async () => {
    await shutdownPostHog();
  });

  it("includes the app version on every tracked event", () => {
    trackAppEvent("app_started");

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "app_started",
        properties: expect.objectContaining({
          team: "posthog-code",
          app_version: "0.0.0-test",
        }),
      }),
    );
  });

  it("lets caller-supplied properties coexist with the app version", () => {
    trackAppEvent("app_quit", { reason: "user-initiated" });

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          reason: "user-initiated",
          app_version: "0.0.0-test",
        }),
      }),
    );
  });

  it("does not let caller-supplied app_version override the system value", () => {
    trackAppEvent("app_quit", { app_version: "spoofed" });

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          app_version: "0.0.0-test",
        }),
      }),
    );
  });

  it("includes the app version on captured exceptions", () => {
    captureException(new Error("boom"));

    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.any(String),
      expect.objectContaining({
        team: "posthog-code",
        app_version: "0.0.0-test",
      }),
    );
  });

  it("does not let additionalProperties override app_version on exceptions", () => {
    captureException(new Error("boom"), { app_version: "spoofed" });

    expect(mockCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.any(String),
      expect.objectContaining({
        app_version: "0.0.0-test",
      }),
    );
  });
});
