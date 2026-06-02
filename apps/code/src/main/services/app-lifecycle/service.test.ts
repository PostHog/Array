import type { IAppLifecycle } from "@posthog/platform/app-lifecycle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLifecycleService } from "./service";

const {
  mockAppLifecycle,
  mockContainer,
  mockDatabaseService,
  mockTrackAppEvent,
  mockShutdownPostHog,
  mockShutdownOtelTransport,
  mockProcessExit,
} = vi.hoisted(() => {
  const mockDatabaseService = {
    close: vi.fn(),
  };
  return {
    mockAppLifecycle: {
      whenReady: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn(),
      exit: vi.fn(),
      onQuit: vi.fn(() => () => {}),
      registerDeepLinkScheme: vi.fn(),
    },
    mockContainer: {
      unbindAll: vi.fn(() => Promise.resolve()),
      get: vi.fn(() => mockDatabaseService),
    },
    mockDatabaseService,
    mockTrackAppEvent: vi.fn(),
    mockShutdownPostHog: vi.fn(() => Promise.resolve()),
    mockShutdownOtelTransport: vi.fn(() => Promise.resolve()),
    mockProcessExit: vi.fn() as unknown as (code?: number) => never,
  };
});

vi.mock("../../utils/logger.js", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("../../utils/otel-log-transport.js", () => ({
  shutdownOtelTransport: mockShutdownOtelTransport,
}));

vi.mock("../posthog-analytics.js", () => ({
  trackAppEvent: mockTrackAppEvent,
  shutdownPostHog: mockShutdownPostHog,
}));

vi.mock("../../di/container.js", () => ({
  container: mockContainer,
}));

vi.mock("../../../shared/types/analytics.js", () => ({
  ANALYTICS_EVENTS: {
    APP_QUIT: "app_quit",
  },
}));

describe("AppLifecycleService", () => {
  let service: AppLifecycleService;
  const originalProcessExit = process.exit;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.exit = mockProcessExit;
    service = new AppLifecycleService(
      mockAppLifecycle as unknown as IAppLifecycle,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    process.exit = originalProcessExit;
  });

  describe("isQuittingForUpdate", () => {
    it("returns false by default", () => {
      expect(service.isQuittingForUpdate).toBe(false);
    });

    it("returns true after setQuittingForUpdate is called", () => {
      service.setQuittingForUpdate();
      expect(service.isQuittingForUpdate).toBe(true);
    });

    it("returns false after clearQuittingForUpdate is called", () => {
      service.setQuittingForUpdate();
      service.clearQuittingForUpdate();
      expect(service.isQuittingForUpdate).toBe(false);
    });
  });

  describe("isShuttingDown", () => {
    it("returns false by default", () => {
      expect(service.isShuttingDown).toBe(false);
    });

    it("returns true after shutdown is called", async () => {
      const shutdownPromise = service.shutdown();
      expect(service.isShuttingDown).toBe(true);
      await vi.runAllTimersAsync();
      await shutdownPromise;
    });
  });

  describe("shutdown", () => {
    it("unbinds all container services", async () => {
      const promise = service.shutdown();
      await vi.runAllTimersAsync();
      await promise;
      expect(mockContainer.unbindAll).toHaveBeenCalled();
    });

    it("tracks app quit event", async () => {
      const promise = service.shutdown();
      await vi.runAllTimersAsync();
      await promise;
      expect(mockTrackAppEvent).toHaveBeenCalledWith("app_quit");
    });

    it("shuts down PostHog", async () => {
      const promise = service.shutdown();
      await vi.runAllTimersAsync();
      await promise;
      expect(mockShutdownPostHog).toHaveBeenCalled();
    });

    it("calls cleanup steps in order", async () => {
      const callOrder: string[] = [];

      mockDatabaseService.close.mockImplementation(() => {
        callOrder.push("dbClose");
      });
      mockContainer.unbindAll.mockImplementation(async () => {
        callOrder.push("unbindAll");
      });
      mockTrackAppEvent.mockImplementation(() => {
        callOrder.push("trackAppEvent");
      });
      mockShutdownOtelTransport.mockImplementation(async () => {
        callOrder.push("shutdownOtelTransport");
      });
      mockShutdownPostHog.mockImplementation(async () => {
        callOrder.push("shutdownPostHog");
      });

      const promise = service.shutdown();
      await vi.runAllTimersAsync();
      await promise;

      expect(callOrder).toEqual([
        "dbClose",
        "unbindAll",
        "trackAppEvent",
        "shutdownOtelTransport",
        "shutdownPostHog",
      ]);
    });

    it("closes the database", async () => {
      const promise = service.shutdown();
      await vi.runAllTimersAsync();
      await promise;
      expect(mockDatabaseService.close).toHaveBeenCalled();
    });

    it("continues shutdown if container unbind fails", async () => {
      mockContainer.unbindAll.mockRejectedValue(new Error("unbind failed"));

      const promise = service.shutdown();
      await vi.runAllTimersAsync();
      await promise;

      expect(mockTrackAppEvent).toHaveBeenCalled();
      expect(mockShutdownPostHog).toHaveBeenCalled();
    });

    it("continues shutdown if PostHog shutdown fails", async () => {
      mockShutdownPostHog.mockRejectedValue(new Error("posthog failed"));

      const promise = service.shutdown();
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBeUndefined();
    });

    it("force-exits on re-entrant shutdown call", async () => {
      const promise = service.shutdown();
      service.shutdown();
      expect(mockProcessExit).toHaveBeenCalledWith(1);
      await vi.runAllTimersAsync();
      await promise;
    });

    it("force-exits when shutdown times out", async () => {
      mockContainer.unbindAll.mockReturnValue(new Promise(() => {}));

      const promise = service.shutdown();

      await vi.advanceTimersByTimeAsync(3000);
      await promise;

      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });

  describe("gracefulExit", () => {
    it("calls shutdown before exit", async () => {
      const callOrder: string[] = [];

      mockDatabaseService.close.mockImplementation(() => {
        callOrder.push("dbClose");
      });
      mockContainer.unbindAll.mockImplementation(async () => {
        callOrder.push("unbindAll");
      });
      mockAppLifecycle.exit.mockImplementation(() => {
        callOrder.push("exit");
      });

      const promise = service.gracefulExit();
      await vi.runAllTimersAsync();
      await promise;

      expect(callOrder[0]).toBe("dbClose");
      expect(callOrder[callOrder.length - 1]).toBe("exit");
    });

    it("exits with code 0", async () => {
      const promise = service.gracefulExit();
      await vi.runAllTimersAsync();
      await promise;
      expect(mockAppLifecycle.exit).toHaveBeenCalledWith(0);
    });
  });
});
