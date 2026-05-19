import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdatesEvent } from "./schemas";

// Use vi.hoisted to ensure mocks are available when vi.mock is hoisted
const {
  mockUpdater,
  mockAppLifecycle,
  mockAppMeta,
  mockMainWindow,
  mockLifecycleService,
  updaterHandlers,
} = vi.hoisted(() => {
  const updaterHandlers: {
    checkStart: (() => void) | null;
    updateAvailable: (() => void) | null;
    noUpdate: (() => void) | null;
    updateDownloaded: ((version: string) => void) | null;
    error: ((error: Error) => void) | null;
    focus: (() => void) | null;
  } = {
    checkStart: null,
    updateAvailable: null,
    noUpdate: null,
    updateDownloaded: null,
    error: null,
    focus: null,
  };

  return {
    updaterHandlers,
    mockUpdater: {
      isSupported: vi.fn(() => true),
      setFeedUrl: vi.fn(),
      check: vi.fn(),
      quitAndInstall: vi.fn(),
      onCheckStart: vi.fn((h: () => void) => {
        updaterHandlers.checkStart = h;
        return () => {};
      }),
      onUpdateAvailable: vi.fn((h: () => void) => {
        updaterHandlers.updateAvailable = h;
        return () => {};
      }),
      onNoUpdate: vi.fn((h: () => void) => {
        updaterHandlers.noUpdate = h;
        return () => {};
      }),
      onUpdateDownloaded: vi.fn((h: (version: string) => void) => {
        updaterHandlers.updateDownloaded = h;
        return () => {};
      }),
      onError: vi.fn((h: (error: Error) => void) => {
        updaterHandlers.error = h;
        return () => {};
      }),
    },
    mockAppLifecycle: {
      whenReady: vi.fn(() => Promise.resolve()),
      quit: vi.fn(),
      exit: vi.fn(),
      onQuit: vi.fn(() => () => {}),
      registerDeepLinkScheme: vi.fn(),
    },
    mockAppMeta: {
      version: "1.0.0",
      isProduction: true,
    },
    mockMainWindow: {
      focus: vi.fn(),
      isFocused: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      onFocus: vi.fn((h: () => void) => {
        updaterHandlers.focus = h;
        return () => {};
      }),
    },
    mockLifecycleService: {
      shutdown: vi.fn(() => Promise.resolve()),
      shutdownWithoutContainer: vi.fn(() => Promise.resolve()),
      setQuittingForUpdate: vi.fn(),
    },
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

vi.mock("../../utils/env.js", () => ({
  isDevBuild: () => !mockAppMeta.isProduction,
}));

// Import the service after mocks are set up
import { UpdatesService } from "./service";

function injectPorts(service: UpdatesService): void {
  const s = service as unknown as Record<string, unknown>;
  s.lifecycleService = mockLifecycleService;
  s.updater = mockUpdater;
  s.appLifecycle = mockAppLifecycle;
  s.appMeta = mockAppMeta;
  s.mainWindow = mockMainWindow;
}

// Helper to initialize service and wait for setup without running the periodic interval infinitely
async function initializeService(service: UpdatesService): Promise<void> {
  service.init();
  // Allow the whenReady promise microtask to resolve
  await vi.advanceTimersByTimeAsync(0);
}

describe("UpdatesService", () => {
  let service: UpdatesService;
  let originalPlatform: PropertyDescriptor | undefined;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Store original values
    originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    originalEnv = { ...process.env };

    // Reset mocks to default state
    mockAppMeta.isProduction = true;
    mockAppMeta.version = "1.0.0";
    mockUpdater.isSupported.mockReturnValue(true);
    mockAppLifecycle.whenReady.mockResolvedValue(undefined);

    // Set default platform to darwin (macOS)
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });

    // Clear env flag
    delete process.env.ELECTRON_DISABLE_AUTO_UPDATE;

    service = new UpdatesService();
    injectPorts(service);
  });

  afterEach(() => {
    vi.useRealTimers();

    // Restore original values
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
    process.env = originalEnv;
  });

  describe("isEnabled", () => {
    it("returns true when app is packaged on macOS", () => {
      mockUpdater.isSupported.mockReturnValue(true);
      Object.defineProperty(process, "platform", {
        value: "darwin",
        configurable: true,
      });

      const newService = new UpdatesService();
      injectPorts(newService);
      expect(newService.isEnabled).toBe(true);
    });

    it("returns true when app is packaged on Windows", () => {
      mockUpdater.isSupported.mockReturnValue(true);
      Object.defineProperty(process, "platform", {
        value: "win32",
        configurable: true,
      });

      const newService = new UpdatesService();
      injectPorts(newService);
      expect(newService.isEnabled).toBe(true);
    });

    it("returns false when app is not packaged", () => {
      mockUpdater.isSupported.mockReturnValue(false);

      const newService = new UpdatesService();
      injectPorts(newService);
      expect(newService.isEnabled).toBe(false);
    });

    it("returns false when ELECTRON_DISABLE_AUTO_UPDATE is set", () => {
      mockUpdater.isSupported.mockReturnValue(true);
      process.env.ELECTRON_DISABLE_AUTO_UPDATE = "1";

      const newService = new UpdatesService();
      injectPorts(newService);
      expect(newService.isEnabled).toBe(false);
    });

    it("returns false on Linux", () => {
      mockUpdater.isSupported.mockReturnValue(true);
      Object.defineProperty(process, "platform", {
        value: "linux",
        configurable: true,
      });

      const newService = new UpdatesService();
      injectPorts(newService);
      expect(newService.isEnabled).toBe(false);
    });

    it("returns false on unsupported platforms", () => {
      mockUpdater.isSupported.mockReturnValue(true);
      Object.defineProperty(process, "platform", {
        value: "freebsd",
        configurable: true,
      });

      const newService = new UpdatesService();
      injectPorts(newService);
      expect(newService.isEnabled).toBe(false);
    });
  });

  describe("init", () => {
    it("sets up auto updater when enabled", async () => {
      await initializeService(service);

      expect(mockMainWindow.onFocus).toHaveBeenCalledWith(expect.any(Function));
      expect(mockAppLifecycle.whenReady).toHaveBeenCalled();
    });

    it("does not set up auto updater when disabled via env flag", () => {
      process.env.ELECTRON_DISABLE_AUTO_UPDATE = "1";

      const newService = new UpdatesService();
      injectPorts(newService);
      newService.init();

      expect(mockAppLifecycle.whenReady).not.toHaveBeenCalled();
    });

    it("does not set up auto updater on unsupported platform", () => {
      Object.defineProperty(process, "platform", {
        value: "linux",
        configurable: true,
      });

      const newService = new UpdatesService();
      injectPorts(newService);
      newService.init();

      expect(mockAppLifecycle.whenReady).not.toHaveBeenCalled();
    });

    it("prevents multiple initializations", async () => {
      await initializeService(service);

      const firstCallCount = mockUpdater.setFeedUrl.mock.calls.length;

      // Simulate whenReady resolving again (shouldn't happen, but testing guard)
      await initializeService(service);

      // setFeedURL should not be called again
      expect(mockUpdater.setFeedUrl.mock.calls.length).toBe(firstCallCount);
    });
  });

  describe("feedUrl", () => {
    it("constructs correct feed URL with platform, arch, and version", async () => {
      Object.defineProperty(process, "arch", {
        value: "arm64",
        configurable: true,
      });
      mockAppMeta.version = "2.0.0";

      await initializeService(service);

      expect(mockUpdater.setFeedUrl).toHaveBeenCalledWith(
        "https://update.electronjs.org/PostHog/code/darwin-arm64/2.0.0",
      );
    });
  });

  describe("checkForUpdates", () => {
    it("returns success when updates are enabled", () => {
      const result = service.checkForUpdates();
      expect(result).toEqual({ success: true });
    });

    it("returns error when updates are disabled (not packaged)", () => {
      mockUpdater.isSupported.mockReturnValue(false);
      mockAppMeta.isProduction = false;

      const newService = new UpdatesService();
      injectPorts(newService);
      const result = newService.checkForUpdates();

      expect(result).toEqual({
        success: false,
        errorMessage: "Updates only available in packaged builds",
        errorCode: "disabled",
      });
    });

    it("returns error when updates are disabled (unsupported platform)", () => {
      Object.defineProperty(process, "platform", {
        value: "linux",
        configurable: true,
      });

      const newService = new UpdatesService();
      injectPorts(newService);
      const result = newService.checkForUpdates();

      expect(result).toEqual({
        success: false,
        errorMessage: "Auto updates only supported on macOS and Windows",
        errorCode: "disabled",
      });
    });

    it("returns error when already checking for updates", () => {
      // First call starts the check
      service.checkForUpdates();

      // Second call should fail
      const result = service.checkForUpdates();
      expect(result).toEqual({
        success: false,
        errorMessage: "Already checking for updates",
        errorCode: "already_checking",
      });
    });

    it("emits status event when checking starts", () => {
      const statusHandler = vi.fn();
      service.on(UpdatesEvent.Status, statusHandler);

      service.checkForUpdates();

      expect(statusHandler).toHaveBeenCalledWith({ checking: true });
    });

    it("calls autoUpdater.checkForUpdates", async () => {
      await initializeService(service);

      // Complete the initial check triggered by setupAutoUpdater
      const notAvailableHandler = updaterHandlers.noUpdate;
      if (notAvailableHandler) {
        notAvailableHandler();
      }

      mockUpdater.check.mockClear();
      service.checkForUpdates();

      expect(mockUpdater.check).toHaveBeenCalled();
    });

    it("allows retry after previous check completes", async () => {
      await initializeService(service);

      // Complete the initial check triggered by setupAutoUpdater
      const notAvailableHandler = updaterHandlers.noUpdate;

      if (notAvailableHandler) {
        notAvailableHandler();
      }

      // First explicit check
      const result1 = service.checkForUpdates();
      expect(result1.success).toBe(true);

      // Simulate completion
      if (notAvailableHandler) {
        notAvailableHandler();
      }

      // Second check should succeed
      const result2 = service.checkForUpdates();
      expect(result2.success).toBe(true);
    });
  });

  describe("hasUpdateReady", () => {
    it("returns false initially", () => {
      expect(service.hasUpdateReady).toBe(false);
    });

    it("returns true after an update is downloaded", async () => {
      await initializeService(service);

      const downloadedHandler = updaterHandlers.updateDownloaded;

      if (downloadedHandler) {
        downloadedHandler("v2.0.0");
      }

      expect(service.hasUpdateReady).toBe(true);
    });
  });

  describe("installUpdate", () => {
    it("returns false when no update is ready", async () => {
      const result = await service.installUpdate();
      expect(result).toEqual({ installed: false });
    });

    it("calls quitAndInstall when update is ready", async () => {
      await initializeService(service);

      // Simulate update downloaded
      const updateDownloadedHandler = updaterHandlers.updateDownloaded;

      if (updateDownloadedHandler) {
        updateDownloadedHandler("v2.0.0");
      }

      const resultPromise = service.installUpdate();
      await vi.runOnlyPendingTimersAsync();
      const result = await resultPromise;
      expect(result).toEqual({ installed: true });

      // Verify setQuittingForUpdate is called first
      expect(mockLifecycleService.setQuittingForUpdate).toHaveBeenCalled();

      // Verify shutdownWithoutContainer is called (not full shutdown)
      expect(mockLifecycleService.shutdownWithoutContainer).toHaveBeenCalled();
      expect(mockLifecycleService.shutdown).not.toHaveBeenCalled();

      // Verify quitAndInstall is called after cleanup
      expect(mockUpdater.quitAndInstall).toHaveBeenCalled();

      // Verify order: setQuittingForUpdate -> shutdownWithoutContainer -> quitAndInstall
      const setQuittingOrder =
        mockLifecycleService.setQuittingForUpdate.mock.invocationCallOrder[0];
      const cleanupOrder =
        mockLifecycleService.shutdownWithoutContainer.mock
          .invocationCallOrder[0];
      const quitAndInstallOrder =
        mockUpdater.quitAndInstall.mock.invocationCallOrder[0];

      expect(setQuittingOrder).toBeLessThan(cleanupOrder);
      expect(cleanupOrder).toBeLessThan(quitAndInstallOrder);
    });

    it("returns false if quitAndInstall throws", async () => {
      await initializeService(service);

      // Simulate update downloaded
      const updateDownloadedHandler = updaterHandlers.updateDownloaded;

      if (updateDownloadedHandler) {
        updateDownloadedHandler("v2.0.0");
      }

      mockUpdater.quitAndInstall.mockImplementation(() => {
        throw new Error("Failed to install");
      });

      const resultPromise = service.installUpdate();
      await vi.runOnlyPendingTimersAsync();
      const result = await resultPromise;
      expect(result).toEqual({ installed: false });
    });
  });

  describe("triggerMenuCheck", () => {
    it("emits CheckFromMenu event", () => {
      const handler = vi.fn();
      service.on(UpdatesEvent.CheckFromMenu, handler);

      service.triggerMenuCheck();

      expect(handler).toHaveBeenCalledWith(true);
    });
  });

  describe("autoUpdater event handling", () => {
    beforeEach(async () => {
      await initializeService(service);
    });

    it("registers all required event handlers", () => {
      expect(mockUpdater.onError).toHaveBeenCalled();
      expect(mockUpdater.onCheckStart).toHaveBeenCalled();
      expect(mockUpdater.onUpdateAvailable).toHaveBeenCalled();
      expect(mockUpdater.onNoUpdate).toHaveBeenCalled();
      expect(mockUpdater.onUpdateDownloaded).toHaveBeenCalled();
    });

    it("handles update-not-available event", () => {
      const statusHandler = vi.fn();
      service.on(UpdatesEvent.Status, statusHandler);

      // Start a check
      service.checkForUpdates();
      statusHandler.mockClear();

      // Simulate no update available
      const notAvailableHandler = updaterHandlers.noUpdate;

      if (notAvailableHandler) {
        notAvailableHandler();
      }

      expect(statusHandler).toHaveBeenCalledWith({
        checking: false,
        upToDate: true,
        version: "1.0.0",
      });
    });

    it("shows update-ready notification instead of up-to-date when update is already downloaded", () => {
      // Simulate update already downloaded
      const downloadedHandler = updaterHandlers.updateDownloaded;
      if (downloadedHandler) {
        downloadedHandler("v2.0.0");
      }

      const statusHandler = vi.fn();
      const readyHandler = vi.fn();
      service.on(UpdatesEvent.Status, statusHandler);
      service.on(UpdatesEvent.Ready, readyHandler);

      // Start a periodic re-check
      service.checkForUpdates("periodic");
      statusHandler.mockClear();

      // Server says no new update available
      const notAvailableHandler = updaterHandlers.noUpdate;
      if (notAvailableHandler) {
        notAvailableHandler();
      }

      // Should emit checking: false (not upToDate)
      expect(statusHandler).toHaveBeenCalledWith({ checking: false });
      expect(statusHandler).not.toHaveBeenCalledWith(
        expect.objectContaining({ upToDate: true }),
      );

      // Should re-surface the downloaded update notification
      expect(readyHandler).toHaveBeenCalledWith({ version: "v2.0.0" });
    });

    it("handles update-downloaded event with version info", () => {
      const readyHandler = vi.fn();
      service.on(UpdatesEvent.Ready, readyHandler);

      // Simulate update downloaded with version
      const downloadedHandler = updaterHandlers.updateDownloaded;

      if (downloadedHandler) {
        downloadedHandler("v2.0.0");
      }

      expect(readyHandler).toHaveBeenCalledWith({ version: "v2.0.0" });
    });

    it("handles error event and emits status with error", () => {
      const statusHandler = vi.fn();
      service.on(UpdatesEvent.Status, statusHandler);

      // Start a check
      service.checkForUpdates();
      statusHandler.mockClear();

      // Simulate error
      const errorHandler = updaterHandlers.error;

      if (errorHandler) {
        errorHandler(new Error("Network error"));
      }

      expect(statusHandler).toHaveBeenCalledWith({
        checking: false,
        error: "Network error",
      });
    });

    it("handles error event gracefully when not checking", () => {
      // Complete the initial check triggered by setupAutoUpdater so we're not in checking state
      const notAvailableHandler = updaterHandlers.noUpdate;
      if (notAvailableHandler) {
        notAvailableHandler();
      }

      const statusHandler = vi.fn();
      service.on(UpdatesEvent.Status, statusHandler);

      // Simulate error without starting a check
      const errorHandler = updaterHandlers.error;

      expect(() => {
        if (errorHandler) {
          errorHandler(new Error("Test error"));
        }
      }).not.toThrow();

      // Should not emit status since we weren't checking
      expect(statusHandler).not.toHaveBeenCalled();
    });
  });

  describe("check timeout", () => {
    beforeEach(async () => {
      await initializeService(service);
    });

    it("times out after 60 seconds if no response", async () => {
      const statusHandler = vi.fn();
      service.on(UpdatesEvent.Status, statusHandler);

      service.checkForUpdates();
      statusHandler.mockClear();

      // Advance 60 seconds
      await vi.advanceTimersByTimeAsync(60 * 1000);

      expect(statusHandler).toHaveBeenCalledWith({
        checking: false,
        error: "Update check timed out. Please try again.",
      });
    });

    it("clears timeout when update-not-available fires", async () => {
      const statusHandler = vi.fn();
      service.on(UpdatesEvent.Status, statusHandler);

      service.checkForUpdates();
      statusHandler.mockClear();

      // Simulate response before timeout
      const notAvailableHandler = updaterHandlers.noUpdate;

      if (notAvailableHandler) {
        notAvailableHandler();
      }

      // Advance past the timeout
      await vi.advanceTimersByTimeAsync(60 * 1000);

      // Should only have received the upToDate status, not a timeout
      expect(statusHandler).toHaveBeenCalledTimes(1);
      expect(statusHandler).toHaveBeenCalledWith({
        checking: false,
        upToDate: true,
        version: "1.0.0",
      });
    });

    it("clears timeout when error fires", async () => {
      const statusHandler = vi.fn();
      service.on(UpdatesEvent.Status, statusHandler);

      service.checkForUpdates();
      statusHandler.mockClear();

      // Simulate error before timeout
      const errorHandler = updaterHandlers.error;

      if (errorHandler) {
        errorHandler(new Error("Network error"));
      }

      // Advance past the timeout
      await vi.advanceTimersByTimeAsync(60 * 1000);

      // Should only have received the error status, not a timeout
      expect(statusHandler).toHaveBeenCalledTimes(1);
      expect(statusHandler).toHaveBeenCalledWith({
        checking: false,
        error: "Network error",
      });
    });
  });

  describe("flushPendingNotification", () => {
    it("emits Ready event on window focus when update is pending", async () => {
      await initializeService(service);

      const readyHandler = vi.fn();
      service.on(UpdatesEvent.Ready, readyHandler);

      // Simulate update downloaded
      const downloadedHandler = updaterHandlers.updateDownloaded;

      if (downloadedHandler) {
        downloadedHandler("v2.0.0");
      }

      // First Ready event from handleUpdateDownloaded
      expect(readyHandler).toHaveBeenCalledTimes(1);

      // Reset the handler count
      readyHandler.mockClear();

      // Pending notification should be false now, so no second emit
      updaterHandlers.focus?.();

      expect(readyHandler).not.toHaveBeenCalled();
    });
  });

  describe("periodic update checks", () => {
    it("performs initial check on setup", async () => {
      await initializeService(service);

      expect(mockUpdater.check).toHaveBeenCalled();
    });

    it("performs check every hour", async () => {
      await initializeService(service);

      const initialCallCount = mockUpdater.check.mock.calls.length;

      // Advance 1 hour
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(mockUpdater.check.mock.calls.length).toBe(initialCallCount + 1);

      // Advance another hour
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

      expect(mockUpdater.check.mock.calls.length).toBe(initialCallCount + 2);
    });
  });

  describe("periodic check re-checks when update already downloaded", () => {
    it("re-checks for newer versions on periodic check when update is ready", async () => {
      await initializeService(service);

      // Simulate update downloaded
      const downloadedHandler = updaterHandlers.updateDownloaded;
      if (downloadedHandler) {
        downloadedHandler("v2.0.0");
      }

      // Clear the checkForUpdates calls from initialization
      mockUpdater.check.mockClear();

      // Periodic check should re-check without resetting existing update state
      const result = service.checkForUpdates("periodic");
      expect(result).toEqual({ success: true });
      expect(mockUpdater.check).toHaveBeenCalled();
      // Update should still be ready (state not reset)
      expect(service.hasUpdateReady).toBe(true);
    });

    it("user check still shows existing notification when update is ready", async () => {
      await initializeService(service);

      // Simulate update downloaded
      const downloadedHandler = updaterHandlers.updateDownloaded;
      if (downloadedHandler) {
        downloadedHandler("v2.0.0");
      }

      const readyHandler = vi.fn();
      service.on(UpdatesEvent.Ready, readyHandler);

      // User check should show existing notification, not re-check
      mockUpdater.check.mockClear();
      const result = service.checkForUpdates("user");
      expect(result).toEqual({ success: true });
      expect(mockUpdater.check).not.toHaveBeenCalled();
      expect(readyHandler).toHaveBeenCalledWith({ version: "v2.0.0" });
    });

    it("preserves downloaded update when periodic re-check errors", async () => {
      await initializeService(service);

      // Simulate update downloaded
      const downloadedHandler = updaterHandlers.updateDownloaded;
      if (downloadedHandler) {
        downloadedHandler("v2.0.0");
      }

      // Periodic check proceeds
      service.checkForUpdates("periodic");

      // Simulate error during re-check
      const errorHandler = updaterHandlers.error;
      if (errorHandler) {
        errorHandler(new Error("Network error"));
      }

      // Update should still be ready
      expect(service.hasUpdateReady).toBe(true);
    });

    it("does not re-notify when same version is re-downloaded after periodic check", async () => {
      await initializeService(service);

      const readyHandler = vi.fn();
      service.on(UpdatesEvent.Ready, readyHandler);

      // First download of v2.0.0
      const downloadedHandler = updaterHandlers.updateDownloaded;
      if (downloadedHandler) {
        downloadedHandler("v2.0.0");
      }
      expect(readyHandler).toHaveBeenCalledTimes(1);

      // Periodic check resets and re-downloads same version
      service.checkForUpdates("periodic");
      readyHandler.mockClear();

      if (downloadedHandler) {
        downloadedHandler("v2.0.0");
      }

      // Should NOT re-notify since same version
      expect(readyHandler).not.toHaveBeenCalled();
    });

    it("returns already_checking when periodic check fires during in-flight check", async () => {
      await initializeService(service);

      // Simulate update downloaded
      const downloadedHandler = updaterHandlers.updateDownloaded;
      if (downloadedHandler) {
        downloadedHandler("v2.0.0");
      }

      // First periodic check starts (sets checkingForUpdates = true)
      service.checkForUpdates("periodic");

      // Second periodic check while first is still in-flight
      const result = service.checkForUpdates("periodic");
      expect(result).toEqual({
        success: false,
        errorMessage: "Already checking for updates",
        errorCode: "already_checking",
      });

      // Update should still be ready (state not corrupted)
      expect(service.hasUpdateReady).toBe(true);
    });

    it("notifies when a newer version is downloaded after periodic check", async () => {
      await initializeService(service);

      const readyHandler = vi.fn();
      service.on(UpdatesEvent.Ready, readyHandler);

      // First download of v2.0.0
      const downloadedHandler = updaterHandlers.updateDownloaded;
      if (downloadedHandler) {
        downloadedHandler("v2.0.0");
      }
      expect(readyHandler).toHaveBeenCalledTimes(1);

      // Periodic check resets and downloads newer v3.0.0
      service.checkForUpdates("periodic");
      readyHandler.mockClear();

      if (downloadedHandler) {
        downloadedHandler("v3.0.0");
      }

      // Should notify since different version
      expect(readyHandler).toHaveBeenCalledWith({ version: "v3.0.0" });
    });
  });

  describe("error handling", () => {
    it("catches errors during checkForUpdates", async () => {
      await initializeService(service);

      mockUpdater.check.mockImplementation(() => {
        throw new Error("Network error");
      });

      // Should not throw
      expect(() => service.checkForUpdates()).not.toThrow();
    });

    it("handles setFeedURL failure gracefully", async () => {
      mockUpdater.setFeedUrl.mockImplementation(() => {
        throw new Error("Invalid URL");
      });

      // Should not throw
      expect(() => {
        const newService = new UpdatesService();
        injectPorts(newService);
        newService.init();
      }).not.toThrow();
    });
  });
});
