import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { AgentSession } from "@features/sessions/stores/sessionStore";
import type { Task } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Hoisted Mocks ---

const mockTrpcAgent = vi.hoisted(() => ({
  start: { mutate: vi.fn() },
  reconnect: { mutate: vi.fn() },
  cancel: { mutate: vi.fn() },
  prompt: { mutate: vi.fn() },
  cancelPrompt: { mutate: vi.fn() },
  setConfigOption: { mutate: vi.fn() },
  respondToPermission: { mutate: vi.fn() },
  cancelPermission: { mutate: vi.fn() },
  onSessionEvent: { subscribe: vi.fn() },
  onPermissionRequest: { subscribe: vi.fn() },
  onSessionIdleKilled: { subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })) },
  resetAll: { mutate: vi.fn().mockResolvedValue(undefined) },
  getPreviewConfigOptions: { query: vi.fn().mockResolvedValue([]) },
}));

const mockTrpcWorkspace = vi.hoisted(() => ({
  verify: { query: vi.fn() },
}));

const mockTrpcLogs = vi.hoisted(() => ({
  fetchS3Logs: { query: vi.fn() },
  readLocalLogs: { query: vi.fn() },
  writeLocalLogs: { mutate: vi.fn() },
}));

const mockTrpcCloudTask = vi.hoisted(() => ({
  sendCommand: { mutate: vi.fn() },
  watch: { mutate: vi.fn().mockResolvedValue(undefined) },
  retry: { mutate: vi.fn().mockResolvedValue(undefined) },
  unwatch: { mutate: vi.fn().mockResolvedValue(undefined) },
  onUpdate: { subscribe: vi.fn() },
}));

const mockTrpcFs = vi.hoisted(() => ({
  readFileAsBase64: { query: vi.fn() },
}));

const mockTrpcHandoff = vi.hoisted(() => ({
  preflightToCloud: { query: vi.fn() },
  executeToCloud: { mutate: vi.fn() },
}));

const mockTrpcOs = vi.hoisted(() => ({
  openExternal: { mutate: vi.fn() },
}));

vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {
    agent: mockTrpcAgent,
    workspace: mockTrpcWorkspace,
    logs: mockTrpcLogs,
    cloudTask: mockTrpcCloudTask,
    fs: mockTrpcFs,
    handoff: mockTrpcHandoff,
    os: mockTrpcOs,
  },
}));

const mockSessionStoreSetters = vi.hoisted(() => ({
  setSession: vi.fn(),
  removeSession: vi.fn(),
  updateSession: vi.fn(),
  updateCloudStatus: vi.fn(),
  appendEvents: vi.fn(),
  enqueueMessage: vi.fn(),
  removeQueuedMessage: vi.fn(),
  clearMessageQueue: vi.fn(),
  dequeueMessagesAsText: vi.fn(() => null),
  dequeueMessages: vi.fn(
    () =>
      [] as Array<{
        id: string;
        content: string;
        rawPrompt?: unknown;
        queuedAt: number;
      }>,
  ),
  prependQueuedMessages: vi.fn(),
  setPendingPermissions: vi.fn(),
  getSessionByTaskId: vi.fn(),
  getSessions: vi.fn(() => ({})),
  clearAll: vi.fn(),
  appendOptimisticItem: vi.fn(),
  clearOptimisticItems: vi.fn(),
  clearTailOptimisticItems: vi.fn(),
  replaceOptimisticWithEvent: vi.fn(),
}));

const mockGetConfigOptionByCategory = vi.hoisted(() =>
  vi.fn(
    (
      _configOptions?: Array<{ category?: string }>,
      _category?: string,
    ): { category?: string } | undefined => undefined,
  ),
);

vi.mock("@features/sessions/stores/sessionStore", () => ({
  sessionStoreSetters: mockSessionStoreSetters,
  getConfigOptionByCategory: mockGetConfigOptionByCategory,
  mergeConfigOptions: vi.fn((live: unknown[], _persisted: unknown[]) => live),
  flattenSelectOptions: vi.fn(
    (options: Array<{ options?: unknown[] }> | undefined) => {
      if (!options?.length) return [];
      const first = options[0] as { options?: unknown[] };
      if (first && Array.isArray(first.options)) {
        return options.flatMap(
          (group) => (group as { options: unknown[] }).options,
        );
      }
      return options;
    },
  ),
}));

const mockAuthenticatedClient = vi.hoisted(() => ({
  createTaskRun: vi.fn(),
  appendTaskRunLog: vi.fn(),
  getTaskRun: vi.fn(),
  getTask: vi.fn(),
  runTaskInCloud: vi.fn(),
  prepareTaskRunArtifactUploads: vi.fn(),
  finalizeTaskRunArtifactUploads: vi.fn(),
  prepareTaskStagedArtifactUploads: vi.fn(),
  finalizeTaskStagedArtifactUploads: vi.fn(),
  startGithubUserIntegrationConnect: vi.fn(),
}));

type MockAuthenticatedClient = typeof mockAuthenticatedClient;

const mockBuildAuthenticatedClient = vi.hoisted(() =>
  vi.fn<() => MockAuthenticatedClient | null>(() => mockAuthenticatedClient),
);

const mockAuth = vi.hoisted(() => ({
  fetchAuthState: vi.fn<() => Promise<Record<string, unknown>>>(async () => ({
    status: "authenticated",
    bootstrapComplete: true,
    cloudRegion: "us",
    projectId: 123,
    availableProjectIds: [123],
    availableOrgIds: [],
    hasCodeAccess: true,
    needsScopeReauth: false,
  })),
  getAuthenticatedClient: vi.fn<() => Promise<Record<string, unknown> | null>>(
    async () => mockBuildAuthenticatedClient(),
  ),
  createAuthenticatedClient: vi.fn((authState: Record<string, unknown>) => {
    return authState.status === "authenticated"
      ? mockBuildAuthenticatedClient()
      : null;
  }),
}));

vi.mock("@features/auth/hooks/authQueries", () => ({
  AUTH_SCOPED_QUERY_META: { authScoped: true },
  clearAuthScopedQueries: vi.fn(),
  getAuthIdentity: vi.fn(),
  fetchAuthState: mockAuth.fetchAuthState,
}));
vi.mock("@features/auth/hooks/authClient", () => ({
  getAuthenticatedClient: mockAuth.getAuthenticatedClient,
  createAuthenticatedClient: mockAuth.createAuthenticatedClient,
}));

vi.mock("@features/sessions/stores/modelsStore", () => ({
  useModelsStore: {
    getState: () => ({
      getEffectiveModel: () => "claude-3-opus",
    }),
  },
}));

const mockSessionConfigStore = vi.hoisted(() => ({
  getPersistedConfigOptions: vi.fn(() => undefined),
  setPersistedConfigOptions: vi.fn(),
  removePersistedConfigOptions: vi.fn(),
  updatePersistedConfigOptionValue: vi.fn(),
}));

vi.mock(
  "@features/sessions/stores/sessionConfigStore",
  () => mockSessionConfigStore,
);

const mockAdapterFns = vi.hoisted(() => ({
  setAdapter: vi.fn(),
  getAdapter: vi.fn(),
  removeAdapter: vi.fn(),
}));

const mockSessionAdapterStore = vi.hoisted(() => ({
  useSessionAdapterStore: {
    getState: vi.fn(() => ({
      adaptersByRunId: {},
      ...mockAdapterFns,
    })),
  },
}));

vi.mock(
  "@features/sessions/stores/sessionAdapterStore",
  () => mockSessionAdapterStore,
);

const mockGetIsOnline = vi.hoisted(() => vi.fn(() => true));

vi.mock("@renderer/stores/connectivityStore", () => ({
  getIsOnline: () => mockGetIsOnline(),
}));

const mockSettingsState = vi.hoisted(() => ({
  customInstructions: "",
}));

vi.mock("@features/settings/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: () => mockSettingsState,
  },
}));

vi.mock("@features/sidebar/hooks/useTaskViewed", () => ({
  taskViewedApi: {
    markActivity: vi.fn(),
    markAsViewed: vi.fn(),
  },
}));

vi.mock("@utils/analytics", () => ({
  track: vi.fn(),
  buildPermissionToolMetadata: vi.fn(() => ({})),
}));
vi.mock("@utils/logger", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));
vi.mock("@utils/notifications", () => ({
  notifyPermissionRequest: vi.fn(),
  notifyPromptComplete: vi.fn(),
}));
vi.mock("@renderer/utils/toast", () => ({
  toast: { error: vi.fn(), info: vi.fn() },
}));
vi.mock("@utils/queryClient", () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
    refetchQueries: vi.fn(),
    setQueriesData: vi.fn(),
  },
}));
vi.mock("@shared/utils/urls", () => ({
  getCloudUrlFromRegion: () => "https://api.anthropic.com",
}));
const mockConvertStoredEntriesToEvents = vi.hoisted(() =>
  vi.fn<(entries: unknown[]) => unknown[]>(() => []),
);

vi.mock("@utils/session", async () => {
  const actual =
    await vi.importActual<typeof import("@utils/session")>("@utils/session");
  return {
    convertStoredEntriesToEvents: mockConvertStoredEntriesToEvents,
    createUserPromptEvent: vi.fn((prompt, ts) => ({
      type: "acp_message",
      ts,
      message: {
        jsonrpc: "2.0",
        id: ts,
        method: "session/prompt",
        params: { prompt },
      },
    })),
    createUserMessageEvent: vi.fn((message, ts) => ({
      type: "user",
      ts,
      message,
    })),
    createUserShellExecuteEvent: vi.fn(() => ({
      type: "acp_message",
      ts: Date.now(),
      message: {},
    })),
    extractPromptText: vi.fn((p) => (typeof p === "string" ? p : "text")),
    getUserShellExecutesSinceLastPrompt: vi.fn(() => []),
    isFatalSessionError: actual.isFatalSessionError,
    isRateLimitError: actual.isRateLimitError,
    normalizePromptToBlocks: vi.fn((p) =>
      typeof p === "string" ? [{ type: "text", text: p }] : p,
    ),
    shellExecutesToContextBlocks: vi.fn(() => []),
  };
});

import { toast } from "@renderer/utils/toast";
import { getSessionService, resetSessionService } from "./service";

// --- Test Fixtures ---

const createMockTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-123",
  task_number: 1,
  slug: "test-task",
  title: "Test Task",
  description: "Test description",
  origin_product: "twig",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  ...overrides,
});

const createMockSession = (
  overrides: Partial<AgentSession> = {},
): AgentSession => ({
  taskRunId: "run-123",
  taskId: "task-123",
  taskTitle: "Test Task",
  channel: "agent-event:run-123",
  events: [],
  startedAt: Date.now(),
  status: "connected",
  isPromptPending: false,
  isCompacting: false,
  promptStartedAt: null,
  pendingPermissions: new Map(),
  pausedDurationMs: 0,
  messageQueue: [],
  optimisticItems: [],
  ...overrides,
});

// --- Tests ---

describe("SessionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConvertStoredEntriesToEvents.mockImplementation(() => []);
    resetSessionService();
    mockSettingsState.customInstructions = "";
    mockGetIsOnline.mockReturnValue(true);
    mockGetConfigOptionByCategory.mockReturnValue(undefined);
    mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(undefined);
    mockSessionStoreSetters.getSessions.mockReturnValue({});
    mockAuth.fetchAuthState.mockResolvedValue({
      status: "authenticated",
      bootstrapComplete: true,
      cloudRegion: "us",
      projectId: 123,
      availableProjectIds: [123],
      availableOrgIds: [],
      hasCodeAccess: true,
      needsScopeReauth: false,
    });
    mockTrpcAgent.onSessionEvent.subscribe.mockReturnValue({
      unsubscribe: vi.fn(),
    });
    mockTrpcAgent.onPermissionRequest.subscribe.mockReturnValue({
      unsubscribe: vi.fn(),
    });
    mockTrpcCloudTask.onUpdate.subscribe.mockReturnValue({
      unsubscribe: vi.fn(),
    });
    mockTrpcFs.readFileAsBase64.query.mockResolvedValue(null);
    mockTrpcHandoff.preflightToCloud.query.mockResolvedValue({
      canHandoff: true,
    });
    mockTrpcHandoff.executeToCloud.mutate.mockResolvedValue({
      success: true,
      logEntryCount: 0,
    });
    mockTrpcOs.openExternal.mutate.mockResolvedValue(undefined);
    mockAuthenticatedClient.prepareTaskRunArtifactUploads.mockResolvedValue([]);
    mockAuthenticatedClient.finalizeTaskRunArtifactUploads.mockResolvedValue(
      [],
    );
    mockAuthenticatedClient.prepareTaskStagedArtifactUploads.mockResolvedValue(
      [],
    );
    mockAuthenticatedClient.finalizeTaskStagedArtifactUploads.mockResolvedValue(
      [],
    );
    mockAuthenticatedClient.startGithubUserIntegrationConnect.mockResolvedValue(
      {
        install_url: "https://github.com/login/oauth/authorize",
        connect_flow: "oauth_authorize",
      },
    );
  });

  describe("singleton management", () => {
    it("returns the same instance on multiple calls", () => {
      const instance1 = getSessionService();
      const instance2 = getSessionService();
      expect(instance1).toBe(instance2);
    });

    it("creates new instance after reset", () => {
      const instance1 = getSessionService();
      resetSessionService();
      const instance2 = getSessionService();
      expect(instance1).not.toBe(instance2);
    });

    it("handles reset when no instance exists", () => {
      expect(() => resetSessionService()).not.toThrow();
    });
  });

  describe("connectToTask", () => {
    it("skips local connection for cloud runs", async () => {
      const service = getSessionService();

      await service.connectToTask({
        task: createMockTask({
          latest_run: {
            id: "run-123",
            task: "task-123",
            team: 123,
            environment: "cloud",
            status: "in_progress",
            log_url: "https://logs.example.com/run-123",
            error_message: null,
            output: null,
            state: {},
            branch: "main",
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
            completed_at: null,
          },
        }),
        repoPath: "/repo",
      });

      expect(mockAuth.fetchAuthState).not.toHaveBeenCalled();
      expect(mockTrpcAgent.reconnect.mutate).not.toHaveBeenCalled();
      expect(mockSessionStoreSetters.setSession).not.toHaveBeenCalled();
    });

    it("skips connection if already connected", async () => {
      const service = getSessionService();
      const mockSession = createMockSession({ status: "connected" });
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(mockSession);

      await service.connectToTask({
        task: createMockTask(),
        repoPath: "/repo",
      });

      expect(mockTrpcAgent.start.mutate).not.toHaveBeenCalled();
    });

    it("skips connection if already connecting", async () => {
      const service = getSessionService();
      const mockSession = createMockSession({ status: "connecting" });
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(mockSession);

      await service.connectToTask({
        task: createMockTask(),
        repoPath: "/repo",
      });

      expect(mockTrpcAgent.start.mutate).not.toHaveBeenCalled();
    });

    it("deduplicates concurrent connection attempts", async () => {
      const service = getSessionService();

      // Setup: no existing session initially
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(undefined);

      // Track how many times createTaskRun is called
      const createTaskRunMock = vi.fn().mockResolvedValue({ id: "run-123" });
      mockAuth.fetchAuthState.mockResolvedValue({
        status: "authenticated",
        bootstrapComplete: true,
        cloudRegion: "us",
        projectId: 123,
        availableProjectIds: [123],
        availableOrgIds: [],
        hasCodeAccess: true,
        needsScopeReauth: false,
      });
      mockBuildAuthenticatedClient.mockReturnValue({
        ...mockAuthenticatedClient,
        createTaskRun: createTaskRunMock,
        appendTaskRunLog: vi.fn(),
      });

      mockTrpcAgent.start.mutate.mockResolvedValue({
        channel: "test-channel",
        currentModelId: "claude-3-opus",
        availableModels: [],
      });
      mockTrpcAgent.onSessionEvent.subscribe.mockReturnValue({
        unsubscribe: vi.fn(),
      });
      mockTrpcAgent.onPermissionRequest.subscribe.mockReturnValue({
        unsubscribe: vi.fn(),
      });

      const task = createMockTask();

      // Make two concurrent connection attempts
      await Promise.all([
        service.connectToTask({ task, repoPath: "/repo" }),
        service.connectToTask({ task, repoPath: "/repo" }),
      ]);

      // createTaskRun should only be called once due to deduplication
      expect(createTaskRunMock).toHaveBeenCalledTimes(1);
    });

    it("creates error session when offline", async () => {
      mockGetIsOnline.mockReturnValue(false);
      const service = getSessionService();

      await service.connectToTask({
        task: createMockTask(),
        repoPath: "/repo",
      });

      expect(mockSessionStoreSetters.setSession).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "disconnected",
          errorMessage: expect.stringContaining("No internet connection"),
        }),
      );
    });

    it("creates error session when auth is missing", async () => {
      const service = getSessionService();

      mockAuth.fetchAuthState.mockResolvedValue({
        status: "anonymous",
        bootstrapComplete: true,
        cloudRegion: null,
        projectId: null,
        availableProjectIds: [],
        availableOrgIds: [],
        hasCodeAccess: null,
        needsScopeReauth: false,
      });
      mockBuildAuthenticatedClient.mockReturnValue(null);

      await service.connectToTask({
        task: createMockTask(),
        repoPath: "/repo",
      });

      expect(mockSessionStoreSetters.setSession).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
          errorMessage: expect.stringContaining("Authentication required"),
        }),
      );
    });

    describe("auto-retry on connect failure", () => {
      const setupFailingConnect = () => {
        const createTaskRun = vi
          .fn()
          .mockRejectedValue(new Error("Internal error"));
        mockBuildAuthenticatedClient.mockReturnValue({
          ...mockAuthenticatedClient,
          createTaskRun,
          appendTaskRunLog: vi.fn(),
        });
        return { createTaskRun };
      };

      it("parks the session in 'connecting' and auto-retries via clearSessionError", async () => {
        vi.useFakeTimers();
        try {
          setupFailingConnect();
          const service = getSessionService();
          const clearSpy = vi
            .spyOn(service, "clearSessionError")
            .mockResolvedValue(undefined);

          const promise = service.connectToTask({
            task: createMockTask(),
            repoPath: "/repo",
          });

          await vi.advanceTimersByTimeAsync(0);
          expect(mockSessionStoreSetters.setSession).toHaveBeenCalledWith(
            expect.objectContaining({ status: "connecting" }),
          );

          await vi.advanceTimersByTimeAsync(10_000);
          await promise;

          expect(clearSpy).toHaveBeenCalledTimes(1);
          expect(clearSpy).toHaveBeenCalledWith("task-123", "/repo");
          expect(mockSessionStoreSetters.setSession).not.toHaveBeenCalledWith(
            expect.objectContaining({ status: "error" }),
          );
        } finally {
          vi.useRealTimers();
        }
      });

      it("flips to error after both auto-retries fail", async () => {
        vi.useFakeTimers();
        try {
          setupFailingConnect();
          const service = getSessionService();
          const clearSpy = vi
            .spyOn(service, "clearSessionError")
            .mockRejectedValue(new Error("retry failed"));
          mockSessionStoreSetters.getSessionByTaskId.mockReturnValue({
            taskRunId: "error-task-123",
            taskId: "task-123",
          });

          const promise = service.connectToTask({
            task: createMockTask(),
            repoPath: "/repo",
          });

          await vi.advanceTimersByTimeAsync(25_000);
          await promise;

          expect(clearSpy).toHaveBeenCalledTimes(2);
          expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
            "error-task-123",
            expect.objectContaining({
              status: "error",
              errorTitle: "Failed to connect",
              errorMessage: "retry failed",
            }),
          );
        } finally {
          vi.useRealTimers();
        }
      });

      it("stops retrying and sets disconnected when device goes offline", async () => {
        vi.useFakeTimers();
        try {
          setupFailingConnect();
          const service = getSessionService();
          const clearSpy = vi
            .spyOn(service, "clearSessionError")
            .mockResolvedValue(undefined);
          mockSessionStoreSetters.getSessionByTaskId.mockReturnValue({
            taskRunId: "error-task-123",
            taskId: "task-123",
          });

          const promise = service.connectToTask({
            task: createMockTask(),
            repoPath: "/repo",
          });

          await vi.advanceTimersByTimeAsync(0);
          mockGetIsOnline.mockReturnValue(false);
          await vi.advanceTimersByTimeAsync(10_000);
          await promise;

          expect(clearSpy).not.toHaveBeenCalled();
          expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
            "error-task-123",
            expect.objectContaining({
              status: "disconnected",
              errorMessage: expect.stringContaining("No internet connection"),
            }),
          );
        } finally {
          vi.useRealTimers();
        }
      });

      it("skips final update when session was dismissed during retry gap", async () => {
        vi.useFakeTimers();
        try {
          setupFailingConnect();
          const service = getSessionService();
          const clearSpy = vi
            .spyOn(service, "clearSessionError")
            .mockRejectedValue(new Error("retry failed"));
          mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(undefined);

          const promise = service.connectToTask({
            task: createMockTask(),
            repoPath: "/repo",
          });

          await vi.advanceTimersByTimeAsync(25_000);
          await promise;

          expect(clearSpy).toHaveBeenCalled();
          expect(mockSessionStoreSetters.updateSession).not.toHaveBeenCalled();
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });

  describe("disconnectFromTask", () => {
    it("does nothing if no session exists", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(undefined);

      await service.disconnectFromTask("task-123");

      expect(mockTrpcAgent.cancel.mutate).not.toHaveBeenCalled();
    });

    it("cancels agent and removes session", async () => {
      const service = getSessionService();
      const mockSession = createMockSession();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(mockSession);

      await service.disconnectFromTask("task-123");

      expect(mockTrpcAgent.cancel.mutate).toHaveBeenCalledWith({
        sessionId: "run-123",
      });
      expect(mockSessionStoreSetters.removeSession).toHaveBeenCalledWith(
        "run-123",
      );
    });

    it("still removes session if cancel fails", async () => {
      const service = getSessionService();
      const mockSession = createMockSession();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(mockSession);
      mockTrpcAgent.cancel.mutate.mockRejectedValue(new Error("Cancel failed"));

      await service.disconnectFromTask("task-123");

      expect(mockSessionStoreSetters.removeSession).toHaveBeenCalledWith(
        "run-123",
      );
    });
  });

  describe("watchCloudTask", () => {
    it("builds codex cloud mode options using native codex modes", () => {
      const service = getSessionService();

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
        undefined,
        undefined,
        "full-access",
        "codex",
      );

      expect(mockSessionStoreSetters.setSession).toHaveBeenCalledWith(
        expect.objectContaining({
          configOptions: [
            expect.objectContaining({
              id: "mode",
              currentValue: "full-access",
              options: [
                expect.objectContaining({ value: "read-only" }),
                expect.objectContaining({ value: "auto" }),
                expect.objectContaining({ value: "full-access" }),
              ],
            }),
          ],
        }),
      );
    });

    it("resets a same-run preloaded session before the first cloud snapshot", () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({
          taskRunId: "run-123",
          taskId: "task-123",
          taskTitle: "Cloud Task",
          events: [{ type: "acp_message", ts: 1, message: { method: "test" } }],
        }),
      );

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://app.example.com",
        2,
      );

      expect(mockSessionStoreSetters.setSession).toHaveBeenCalledWith(
        expect.objectContaining({
          taskRunId: "run-123",
          taskId: "task-123",
          taskTitle: "Cloud Task",
          isCloud: true,
          status: "disconnected",
          events: [],
        }),
      );
      expect(mockSessionStoreSetters.updateSession).not.toHaveBeenCalledWith(
        "run-123",
        expect.objectContaining({ isCloud: true }),
      );
    });

    it("subscribes to cloud updates before starting the watcher", async () => {
      const service = getSessionService();

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
      );

      expect(mockTrpcCloudTask.onUpdate.subscribe).toHaveBeenCalledWith(
        { taskId: "task-123", runId: "run-123" },
        expect.objectContaining({
          onData: expect.any(Function),
          onError: expect.any(Function),
        }),
      );

      expect(mockTrpcCloudTask.watch.mutate).toHaveBeenCalledWith({
        taskId: "task-123",
        runId: "run-123",
        apiHost: "https://api.anthropic.com",
        teamId: 123,
      });

      expect(
        mockTrpcCloudTask.onUpdate.subscribe.mock.invocationCallOrder[0],
      ).toBeLessThan(
        mockTrpcCloudTask.watch.mutate.mock.invocationCallOrder[0],
      );
    });

    it("keeps the cloud watcher alive when the caller cleanup runs", () => {
      const service = getSessionService();
      const unsubscribe = vi.fn();
      mockTrpcCloudTask.onUpdate.subscribe.mockReturnValueOnce({
        unsubscribe,
      });

      const cleanup = service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
      );
      cleanup();

      expect(unsubscribe).not.toHaveBeenCalled();
      expect(mockTrpcCloudTask.unwatch.mutate).not.toHaveBeenCalled();
    });

    it("reuses the existing watcher across effect churn", () => {
      const service = getSessionService();
      const unsubscribe = vi.fn();
      mockTrpcCloudTask.onUpdate.subscribe.mockReturnValueOnce({
        unsubscribe,
      });

      const firstCleanup = service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
      );
      firstCleanup();
      const secondCleanup = service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
      );

      expect(unsubscribe).not.toHaveBeenCalled();
      expect(mockTrpcCloudTask.watch.mutate).toHaveBeenCalledTimes(1);

      secondCleanup();
      expect(unsubscribe).not.toHaveBeenCalled();
    });

    it("preserves an existing status callback when reusing a watcher without one", () => {
      const service = getSessionService();
      const onStatusChange = vi.fn();

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
        onStatusChange,
      );
      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
      );

      const subscribeOptions = mockTrpcCloudTask.onUpdate.subscribe.mock
        .calls[0][1] as {
        onData: (update: {
          kind: "status";
          taskId: string;
          runId: string;
          status: "in_progress";
        }) => void;
      };
      subscribeOptions.onData({
        kind: "status",
        taskId: "task-123",
        runId: "run-123",
        status: "in_progress",
      });

      expect(onStatusChange).toHaveBeenCalledTimes(1);
    });

    it("hydrates a fresh cloud session from persisted logs before replay arrives", async () => {
      const service = getSessionService();
      const hydratedSession = createMockSession({
        taskRunId: "run-123",
        taskId: "task-123",
        taskTitle: "Cloud Task",
        status: "disconnected",
        isCloud: true,
        events: [],
      });

      mockSessionStoreSetters.getSessionByTaskId.mockImplementation(() => {
        return hydratedSession;
      });
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue("");
      mockTrpcLogs.fetchS3Logs.query.mockResolvedValue(
        JSON.stringify({
          type: "notification",
          timestamp: "2024-01-01T00:00:00Z",
          notification: {
            method: "session/update",
            params: {
              update: {
                sessionUpdate: "assistant_message",
              },
            },
          },
        }),
      );
      mockTrpcLogs.writeLocalLogs.mutate.mockResolvedValue(undefined);

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
        undefined,
        "https://logs.example.com/run-123",
      );

      await vi.waitFor(() => {
        expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
          "run-123",
          expect.objectContaining({
            events: [],
            isCloud: true,
            logUrl: "https://logs.example.com/run-123",
            processedLineCount: 1,
          }),
        );
      });
    });

    it("flips isPromptPending on hydration when the log tail has an in-flight prompt", async () => {
      const service = getSessionService();
      const hydratedSession = createMockSession({
        taskRunId: "run-123",
        taskId: "task-123",
        status: "disconnected",
        isCloud: true,
        events: [],
      });
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        hydratedSession,
      );
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue("");
      mockTrpcLogs.fetchS3Logs.query.mockResolvedValue("{}");
      mockTrpcLogs.writeLocalLogs.mutate.mockResolvedValue(undefined);

      const inFlightPrompt = {
        type: "acp_message" as const,
        ts: 1700000000,
        message: {
          jsonrpc: "2.0" as const,
          id: 42,
          method: "session/prompt",
          params: { prompt: [{ type: "text", text: "hi" }] },
        },
      };
      mockConvertStoredEntriesToEvents.mockReturnValueOnce([inFlightPrompt]);

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
        undefined,
        "https://logs.example.com/run-123",
      );

      await vi.waitFor(() => {
        expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
          "run-123",
          expect.objectContaining({
            isPromptPending: true,
            promptStartedAt: inFlightPrompt.ts,
            currentPromptId: 42,
          }),
        );
      });
    });

    it("leaves isPromptPending false on hydration when the log tail has a completed prompt", async () => {
      const service = getSessionService();
      const hydratedSession = createMockSession({
        taskRunId: "run-123",
        taskId: "task-123",
        status: "disconnected",
        isCloud: true,
        events: [],
      });
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        hydratedSession,
      );
      mockSessionStoreSetters.getSessions.mockReturnValue({
        "run-123": { ...hydratedSession, currentPromptId: 42 },
      });
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue("");
      mockTrpcLogs.fetchS3Logs.query.mockResolvedValue("{}");
      mockTrpcLogs.writeLocalLogs.mutate.mockResolvedValue(undefined);

      const promptRequest = {
        type: "acp_message" as const,
        ts: 1700000000,
        message: {
          jsonrpc: "2.0" as const,
          id: 42,
          method: "session/prompt",
          params: { prompt: [{ type: "text", text: "hi" }] },
        },
      };
      const promptResponse = {
        type: "acp_message" as const,
        ts: 1700000005,
        message: {
          jsonrpc: "2.0" as const,
          id: 42,
          result: { stopReason: "end_turn" },
        },
      };
      mockConvertStoredEntriesToEvents.mockReturnValueOnce([
        promptRequest,
        promptResponse,
      ]);

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
        undefined,
        "https://logs.example.com/run-123",
      );

      await vi.waitFor(() => {
        expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
          "run-123",
          expect.objectContaining({
            isPromptPending: false,
            promptStartedAt: null,
            currentPromptId: null,
          }),
        );
      });
    });

    it("flushes queued cloud messages on _posthog/turn_complete", async () => {
      const service = getSessionService();
      // Reset auth client (a prior test may have set it to null).
      mockBuildAuthenticatedClient.mockReturnValue(mockAuthenticatedClient);
      const queuedMessage = {
        id: "q-1",
        content: "follow up",
        queuedAt: 1700000000,
      };
      const sessionWithQueue = createMockSession({
        taskRunId: "run-123",
        taskId: "task-123",
        status: "connected",
        isCloud: true,
        cloudStatus: "in_progress",
        events: [],
        messageQueue: [queuedMessage],
      });
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        sessionWithQueue,
      );
      mockSessionStoreSetters.getSessions.mockReturnValue({
        "run-123": sessionWithQueue,
      });
      mockSessionStoreSetters.dequeueMessages.mockReturnValue([queuedMessage]);
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue("");
      mockTrpcLogs.fetchS3Logs.query.mockResolvedValue("{}");
      mockTrpcLogs.writeLocalLogs.mutate.mockResolvedValue(undefined);
      mockTrpcCloudTask.sendCommand.mutate.mockResolvedValue({
        success: true,
        result: { stopReason: "end_turn" },
      });

      const turnCompleteEvent = {
        type: "acp_message" as const,
        ts: 1700000001,
        message: {
          jsonrpc: "2.0" as const,
          method: "_posthog/turn_complete",
          params: { sessionId: "acp-session", stopReason: "end_turn" },
        },
      };
      mockConvertStoredEntriesToEvents.mockReturnValueOnce([turnCompleteEvent]);

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
        undefined,
        "https://logs.example.com/run-123",
      );

      await vi.waitFor(() => {
        expect(mockTrpcCloudTask.sendCommand.mutate).toHaveBeenCalledWith(
          expect.objectContaining({
            taskId: "task-123",
            method: "user_message",
            params: expect.objectContaining({ content: "follow up" }),
          }),
        );
      });
    });

    it("re-enqueues queued cloud messages when the dispatch fails", async () => {
      const service = getSessionService();
      const queuedMessage = {
        id: "q-1",
        content: "follow up",
        queuedAt: 1700000000,
      };
      const sessionWithQueue = createMockSession({
        taskRunId: "run-123",
        taskId: "task-123",
        status: "connected",
        isCloud: true,
        cloudStatus: "in_progress",
        events: [],
        messageQueue: [queuedMessage],
      });
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        sessionWithQueue,
      );
      mockSessionStoreSetters.getSessions.mockReturnValue({
        "run-123": sessionWithQueue,
      });
      mockSessionStoreSetters.dequeueMessages.mockReturnValue([queuedMessage]);
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue("");
      mockTrpcLogs.fetchS3Logs.query.mockResolvedValue("{}");
      mockTrpcLogs.writeLocalLogs.mutate.mockResolvedValue(undefined);
      mockTrpcCloudTask.sendCommand.mutate.mockRejectedValue(
        new Error("transient backend failure"),
      );

      const turnCompleteEvent = {
        type: "acp_message" as const,
        ts: 1700000001,
        message: {
          jsonrpc: "2.0" as const,
          method: "_posthog/turn_complete",
          params: { sessionId: "acp-session", stopReason: "end_turn" },
        },
      };
      mockConvertStoredEntriesToEvents.mockReturnValueOnce([turnCompleteEvent]);

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
        undefined,
        "https://logs.example.com/run-123",
      );

      await vi.waitFor(() => {
        expect(
          mockSessionStoreSetters.prependQueuedMessages,
        ).toHaveBeenCalledWith("task-123", [queuedMessage]);
      });
    });

    it("upgrades status to connected on turn_complete when run_started was never received", async () => {
      const service = getSessionService();
      mockBuildAuthenticatedClient.mockReturnValue(mockAuthenticatedClient);
      const queuedMessage = {
        id: "q-1",
        content: "follow up",
        queuedAt: 1700000000,
      };
      // Session starts disconnected — simulates an old agent that never
      // emitted _posthog/run_started.
      const sessionWithQueue = createMockSession({
        taskRunId: "run-123",
        taskId: "task-123",
        status: "disconnected",
        isCloud: true,
        cloudStatus: "in_progress",
        events: [],
        messageQueue: [queuedMessage],
      });
      // After the turn_complete handler flips status to "connected",
      // sendQueuedCloudMessages reads the session again via
      // getSessionByTaskId. We return the disconnected version first
      // (for the turn_complete handler) then the connected version
      // (for the queue dispatcher's canSendNow check).
      const connectedSession = createMockSession({
        ...sessionWithQueue,
        status: "connected",
      });
      mockSessionStoreSetters.getSessions.mockReturnValue({
        "run-123": sessionWithQueue,
      });
      mockSessionStoreSetters.getSessionByTaskId
        .mockReturnValueOnce(sessionWithQueue)
        .mockReturnValue(connectedSession);
      mockSessionStoreSetters.dequeueMessages.mockReturnValue([queuedMessage]);
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue("");
      mockTrpcLogs.fetchS3Logs.query.mockResolvedValue("{}");
      mockTrpcLogs.writeLocalLogs.mutate.mockResolvedValue(undefined);
      mockTrpcCloudTask.sendCommand.mutate.mockResolvedValue({
        success: true,
        result: { stopReason: "end_turn" },
      });

      const turnCompleteEvent = {
        type: "acp_message" as const,
        ts: 1700000001,
        message: {
          jsonrpc: "2.0" as const,
          method: "_posthog/turn_complete",
          params: { sessionId: "acp-session", stopReason: "end_turn" },
        },
      };
      mockConvertStoredEntriesToEvents.mockReturnValueOnce([turnCompleteEvent]);

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
        undefined,
        "https://logs.example.com/run-123",
      );

      await vi.waitFor(() => {
        expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
          "run-123",
          { status: "connected" },
        );
      });

      await vi.waitFor(() => {
        expect(mockTrpcCloudTask.sendCommand.mutate).toHaveBeenCalledWith(
          expect.objectContaining({
            taskId: "task-123",
            method: "user_message",
            params: expect.objectContaining({ content: "follow up" }),
          }),
        );
      });
    });

    it("clears isPromptPending from structured turn completion logs on hydration", async () => {
      const service = getSessionService();
      const hydratedSession = createMockSession({
        taskRunId: "run-123",
        taskId: "task-123",
        status: "disconnected",
        isCloud: true,
        events: [],
      });
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        hydratedSession,
      );
      mockSessionStoreSetters.getSessions.mockReturnValue({
        "run-123": { ...hydratedSession, currentPromptId: 42 },
      });
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue("");
      mockTrpcLogs.fetchS3Logs.query.mockResolvedValue("{}");
      mockTrpcLogs.writeLocalLogs.mutate.mockResolvedValue(undefined);

      const promptRequest = {
        type: "acp_message" as const,
        ts: 1700000000,
        message: {
          jsonrpc: "2.0" as const,
          id: 42,
          method: "session/prompt",
          params: { prompt: [{ type: "text", text: "hi" }] },
        },
      };
      const completion = {
        type: "acp_message" as const,
        ts: 1700000005,
        message: {
          jsonrpc: "2.0" as const,
          method: "_posthog/turn_complete",
          params: {
            sessionId: "session-1",
            stopReason: "end_turn",
          },
        },
      };
      mockConvertStoredEntriesToEvents.mockReturnValueOnce([
        promptRequest,
        completion,
      ]);

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
        undefined,
        "https://logs.example.com/run-123",
      );

      await vi.waitFor(() => {
        expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
          "run-123",
          expect.objectContaining({
            isPromptPending: false,
            promptStartedAt: null,
            currentPromptId: null,
          }),
        );
      });
    });

    it("reconciles cloud log gaps from persisted logs", async () => {
      const service = getSessionService();
      const existingSession = createMockSession({
        taskRunId: "run-123",
        taskId: "task-123",
        status: "connected",
        isCloud: true,
        logUrl: "https://logs.example.com/run-123",
        processedLineCount: 5,
        events: [
          {
            type: "acp_message",
            ts: 1,
            message: { method: "existing" },
          },
        ],
      });
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        existingSession,
      );
      mockSessionStoreSetters.getSessions.mockReturnValue({
        "run-123": existingSession,
      });

      const storedLine = JSON.stringify({
        type: "notification",
        timestamp: "2024-01-01T00:00:00Z",
        notification: {
          method: "session/update",
          params: { update: { sessionUpdate: "assistant_message" } },
        },
      });
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue(
        Array.from({ length: 14 }, () => storedLine).join("\n"),
      );

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
      );
      const subscribeOptions = mockTrpcCloudTask.onUpdate.subscribe.mock
        .calls[0][1] as {
        onData: (update: unknown) => void;
      };

      subscribeOptions.onData({
        kind: "logs",
        taskId: "task-123",
        runId: "run-123",
        totalEntryCount: 14,
        newEntries: [
          {
            type: "notification",
            timestamp: "2024-01-01T00:00:01Z",
            notification: {
              method: "session/update",
              params: { update: { sessionUpdate: "assistant_message" } },
            },
          },
        ],
      });

      await vi.waitFor(() => {
        expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
          "run-123",
          expect.objectContaining({
            events: [],
            isCloud: true,
            logUrl: "https://logs.example.com/run-123",
            processedLineCount: 14,
          }),
        );
      });
      expect(mockSessionStoreSetters.appendEvents).not.toHaveBeenCalled();
    });

    it("falls back to remote logs when local gap repair cache is stale", async () => {
      const service = getSessionService();
      const existingSession = createMockSession({
        taskRunId: "run-123",
        taskId: "task-123",
        status: "connected",
        isCloud: true,
        logUrl: "https://logs.example.com/run-123",
        processedLineCount: 5,
        events: [
          {
            type: "acp_message",
            ts: 1,
            message: { method: "existing" },
          },
        ],
      });
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        existingSession,
      );
      mockSessionStoreSetters.getSessions.mockReturnValue({
        "run-123": existingSession,
      });

      const storedLine = JSON.stringify({
        type: "notification",
        timestamp: "2024-01-01T00:00:00Z",
        notification: {
          method: "session/update",
          params: { update: { sessionUpdate: "assistant_message" } },
        },
      });
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue(
        Array.from({ length: 5 }, () => storedLine).join("\n"),
      );
      mockTrpcLogs.fetchS3Logs.query.mockResolvedValue(
        Array.from({ length: 14 }, () => storedLine).join("\n"),
      );

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
      );
      const subscribeOptions = mockTrpcCloudTask.onUpdate.subscribe.mock
        .calls[0][1] as {
        onData: (update: unknown) => void;
      };

      subscribeOptions.onData({
        kind: "logs",
        taskId: "task-123",
        runId: "run-123",
        totalEntryCount: 14,
        newEntries: [
          {
            type: "notification",
            timestamp: "2024-01-01T00:00:01Z",
            notification: {
              method: "session/update",
              params: { update: { sessionUpdate: "assistant_message" } },
            },
          },
        ],
      });

      await vi.waitFor(() => {
        expect(mockTrpcLogs.fetchS3Logs.query).toHaveBeenCalledWith({
          logUrl: "https://logs.example.com/run-123",
        });
        expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
          "run-123",
          expect.objectContaining({
            processedLineCount: 14,
          }),
        );
      });
      expect(mockSessionStoreSetters.appendEvents).not.toHaveBeenCalled();
    });

    it("processes a pending cloud log gap after active reconciliation finishes", async () => {
      const service = getSessionService();
      let sessionState = createMockSession({
        taskRunId: "run-123",
        taskId: "task-123",
        status: "connected",
        isCloud: true,
        logUrl: "https://logs.example.com/run-123",
        processedLineCount: 5,
        events: [
          {
            type: "acp_message",
            ts: 1,
            message: { method: "existing" },
          },
        ],
      });
      mockSessionStoreSetters.getSessionByTaskId.mockImplementation(
        () => sessionState,
      );
      mockSessionStoreSetters.getSessions.mockImplementation(() => ({
        "run-123": sessionState,
      }));
      mockSessionStoreSetters.appendEvents.mockImplementation(
        (_taskRunId, events, processedLineCount) => {
          sessionState = {
            ...sessionState,
            events: [...sessionState.events, ...events],
            processedLineCount,
          };
        },
      );

      let resolveFirstLocalLogs!: (content: string) => void;
      mockTrpcLogs.readLocalLogs.query
        .mockImplementationOnce(
          () =>
            new Promise<string>((resolve) => {
              resolveFirstLocalLogs = resolve;
            }),
        )
        .mockResolvedValue("");
      mockTrpcLogs.fetchS3Logs.query.mockResolvedValue("");
      mockConvertStoredEntriesToEvents.mockImplementation((entries) =>
        entries.map((entry, index) => ({
          type: "acp_message",
          ts: index,
          message: {
            jsonrpc: "2.0",
            method: "session/update",
            params: { entry },
          },
        })),
      );

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
      );
      const subscribeOptions = mockTrpcCloudTask.onUpdate.subscribe.mock
        .calls[0][1] as {
        onData: (update: unknown) => void;
      };
      const firstEntry = {
        type: "notification",
        timestamp: "2024-01-01T00:00:01Z",
        notification: { method: "session/update" },
      };
      const secondEntry = {
        type: "notification",
        timestamp: "2024-01-01T00:00:02Z",
        notification: { method: "session/update" },
      };
      const thirdEntry = {
        type: "notification",
        timestamp: "2024-01-01T00:00:03Z",
        notification: { method: "session/update" },
      };

      subscribeOptions.onData({
        kind: "logs",
        taskId: "task-123",
        runId: "run-123",
        totalEntryCount: 14,
        newEntries: [firstEntry],
      });
      await vi.waitFor(() => {
        expect(mockTrpcLogs.readLocalLogs.query).toHaveBeenCalledTimes(1);
      });

      subscribeOptions.onData({
        kind: "logs",
        taskId: "task-123",
        runId: "run-123",
        totalEntryCount: 16,
        newEntries: [secondEntry, thirdEntry],
      });
      resolveFirstLocalLogs("");

      await vi.waitFor(() => {
        expect(mockSessionStoreSetters.appendEvents).toHaveBeenCalledTimes(2);
      });
      expect(mockSessionStoreSetters.appendEvents).toHaveBeenNthCalledWith(
        1,
        "run-123",
        [
          expect.objectContaining({
            message: expect.objectContaining({
              params: { entry: firstEntry },
            }),
          }),
        ],
        6,
      );
      expect(mockSessionStoreSetters.appendEvents).toHaveBeenNthCalledWith(
        2,
        "run-123",
        [
          expect.objectContaining({
            message: expect.objectContaining({
              params: { entry: secondEntry },
            }),
          }),
          expect.objectContaining({
            message: expect.objectContaining({
              params: { entry: thirdEntry },
            }),
          }),
        ],
        8,
      );
    });
    it("flips status to connected on _posthog/run_started", async () => {
      const service = getSessionService();
      const hydratedSession = createMockSession({
        taskRunId: "run-123",
        taskId: "task-123",
        status: "disconnected",
        isCloud: true,
        events: [],
      });
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        hydratedSession,
      );
      mockSessionStoreSetters.getSessions.mockReturnValue({
        "run-123": hydratedSession,
      });
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue("");
      mockTrpcLogs.fetchS3Logs.query.mockResolvedValue("{}");
      mockTrpcLogs.writeLocalLogs.mutate.mockResolvedValue(undefined);

      const runStartedEvent = {
        type: "acp_message" as const,
        ts: 1700000000,
        message: {
          jsonrpc: "2.0" as const,
          method: "_posthog/run_started",
          params: {
            sessionId: "acp-session",
            runId: "run-123",
            taskId: "task-123",
          },
        },
      };
      mockConvertStoredEntriesToEvents.mockReturnValueOnce([runStartedEvent]);

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
        undefined,
        "https://logs.example.com/run-123",
      );

      await vi.waitFor(() => {
        expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
          "run-123",
          { status: "connected" },
        );
      });
    });

    it("captures agentVersion from run_started params onto the session", async () => {
      const service = getSessionService();
      const hydratedSession = createMockSession({
        taskRunId: "run-123",
        taskId: "task-123",
        status: "disconnected",
        isCloud: true,
        events: [],
      });
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        hydratedSession,
      );
      mockSessionStoreSetters.getSessions.mockReturnValue({
        "run-123": hydratedSession,
      });
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue("");
      mockTrpcLogs.fetchS3Logs.query.mockResolvedValue("{}");
      mockTrpcLogs.writeLocalLogs.mutate.mockResolvedValue(undefined);

      const runStartedEvent = {
        type: "acp_message" as const,
        ts: 1700000000,
        message: {
          jsonrpc: "2.0" as const,
          method: "_posthog/run_started",
          params: {
            sessionId: "acp-session",
            runId: "run-123",
            taskId: "task-123",
            agentVersion: "0.42.3",
          },
        },
      };
      mockConvertStoredEntriesToEvents.mockReturnValueOnce([runStartedEvent]);

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
        undefined,
        "https://logs.example.com/run-123",
      );

      await vi.waitFor(() => {
        expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
          "run-123",
          expect.objectContaining({
            agentVersion: "0.42.3",
            status: "connected",
          }),
        );
      });
    });

    it("does not re-flip status when run_started arrives but session is already connected", async () => {
      const service = getSessionService();
      const connectedSession = createMockSession({
        taskRunId: "run-123",
        taskId: "task-123",
        status: "connected",
        isCloud: true,
        events: [],
      });
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        connectedSession,
      );
      mockSessionStoreSetters.getSessions.mockReturnValue({
        "run-123": connectedSession,
      });
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue("");
      mockTrpcLogs.fetchS3Logs.query.mockResolvedValue("{}");
      mockTrpcLogs.writeLocalLogs.mutate.mockResolvedValue(undefined);

      const runStartedEvent = {
        type: "acp_message" as const,
        ts: 1700000000,
        message: {
          jsonrpc: "2.0" as const,
          method: "_posthog/run_started",
          params: {
            sessionId: "acp-session",
            runId: "run-123",
            taskId: "task-123",
          },
        },
      };
      mockConvertStoredEntriesToEvents.mockReturnValueOnce([runStartedEvent]);

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
        undefined,
        "https://logs.example.com/run-123",
      );

      // Wait long enough for the hydration callback to run; assert the
      // store was never told to set status: "connected" again.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mockSessionStoreSetters.updateSession).not.toHaveBeenCalledWith(
        "run-123",
        { status: "connected" },
      );
    });

    it("seeds an optimistic user-message when hydrating a brand-new task with no prior history", async () => {
      const service = getSessionService();
      const freshSession = createMockSession({
        taskRunId: "run-123",
        taskId: "task-123",
        status: "disconnected",
        isCloud: true,
        events: [],
      });
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(freshSession);
      mockSessionStoreSetters.getSessions.mockReturnValue({
        "run-123": freshSession,
      });
      // Empty history — fetchSessionLogs returns no entries.
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue("");
      mockTrpcLogs.fetchS3Logs.query.mockResolvedValue("");
      mockTrpcLogs.writeLocalLogs.mutate.mockResolvedValue(undefined);

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
        undefined,
        "https://logs.example.com/run-123",
        undefined,
        "claude",
        undefined,
        "build me a thing",
      );

      await vi.waitFor(() => {
        expect(
          mockSessionStoreSetters.appendOptimisticItem,
        ).toHaveBeenCalledWith(
          "run-123",
          expect.objectContaining({
            type: "user_message",
            content: "build me a thing",
          }),
        );
      });
    });

    it("seeds an optimistic user-message when persisted entries exist but no session/prompt yet (agent emitted lifecycle notifications first)", async () => {
      const service = getSessionService();
      const freshSession = createMockSession({
        taskRunId: "run-123",
        taskId: "task-123",
        status: "disconnected",
        isCloud: true,
        events: [],
      });
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(freshSession);
      mockSessionStoreSetters.getSessions.mockReturnValue({
        "run-123": freshSession,
      });
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue("");
      mockTrpcLogs.fetchS3Logs.query.mockResolvedValue(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "_posthog/run_started",
          params: {
            sessionId: "acp-session-1",
            runId: "run-123",
            taskId: "task-123",
          },
        }),
      );
      mockTrpcLogs.writeLocalLogs.mutate.mockResolvedValue(undefined);

      // Lifecycle notification only — no session/prompt request yet.
      const lifecycleNotification = {
        type: "acp_message" as const,
        ts: 1700000000,
        message: {
          jsonrpc: "2.0" as const,
          method: "_posthog/run_started",
          params: {
            sessionId: "acp-session-1",
            runId: "run-123",
            taskId: "task-123",
          },
        },
      };
      mockConvertStoredEntriesToEvents.mockReturnValueOnce([
        lifecycleNotification,
      ]);

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
        undefined,
        "https://logs.example.com/run-123",
        undefined,
        "claude",
        undefined,
        "build me a thing",
      );

      await vi.waitFor(() => {
        expect(
          mockSessionStoreSetters.appendOptimisticItem,
        ).toHaveBeenCalledWith(
          "run-123",
          expect.objectContaining({
            type: "user_message",
            content: "build me a thing",
          }),
        );
      });
    });

    it("does NOT seed an optimistic user-message when hydration finds prior history", async () => {
      const service = getSessionService();
      const reopenedSession = createMockSession({
        taskRunId: "run-123",
        taskId: "task-123",
        status: "disconnected",
        isCloud: true,
        events: [],
      });
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        reopenedSession,
      );
      mockSessionStoreSetters.getSessions.mockReturnValue({
        "run-123": reopenedSession,
      });
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue("");
      // Non-empty history: a prior session/prompt exists.
      mockTrpcLogs.fetchS3Logs.query.mockResolvedValue(
        JSON.stringify({
          type: "request",
          timestamp: "2024-01-01T00:00:00Z",
          request: {
            jsonrpc: "2.0",
            id: 1,
            method: "session/prompt",
            params: { prompt: [{ type: "text", text: "hello there" }] },
          },
        }),
      );
      mockTrpcLogs.writeLocalLogs.mutate.mockResolvedValue(undefined);

      const priorPrompt = {
        type: "acp_message" as const,
        ts: 1700000000,
        message: {
          jsonrpc: "2.0" as const,
          id: 1,
          method: "session/prompt",
          params: { prompt: [{ type: "text", text: "hello there" }] },
        },
      };
      mockConvertStoredEntriesToEvents.mockReturnValueOnce([priorPrompt]);

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
        undefined,
        "https://logs.example.com/run-123",
        undefined,
        "claude",
        undefined,
        "hello there",
      );

      // Wait for hydration to run.
      await vi.waitFor(() => {
        expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
          "run-123",
          expect.objectContaining({ events: [priorPrompt] }),
        );
      });
      expect(
        mockSessionStoreSetters.appendOptimisticItem,
      ).not.toHaveBeenCalled();
    });
    it("ignores stale async starts when the same watcher is replaced", async () => {
      const service = getSessionService();
      let resolveFirstWatchStart!: () => void;
      let resolveSecondWatchStart!: () => void;

      mockTrpcCloudTask.watch.mutate
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveFirstWatchStart = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveSecondWatchStart = resolve;
            }),
        );

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
      );
      service.stopCloudTaskWatch("task-123");
      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
      );

      resolveSecondWatchStart();
      await Promise.resolve();
      await Promise.resolve();

      resolveFirstWatchStart();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockTrpcCloudTask.watch.mutate).toHaveBeenCalledTimes(2);
    });

    it("sends a compensating unwatch if teardown wins the race after watch starts", async () => {
      const service = getSessionService();
      let resolveWatchStart!: () => void;
      mockTrpcCloudTask.unwatch.mutate.mockClear();

      mockTrpcCloudTask.watch.mutate.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveWatchStart = resolve;
          }),
      );

      service.watchCloudTask(
        "task-123",
        "run-123",
        "https://api.anthropic.com",
        123,
      );

      service.stopCloudTaskWatch("task-123");
      expect(mockTrpcCloudTask.unwatch.mutate).not.toHaveBeenCalled();

      resolveWatchStart();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockTrpcCloudTask.unwatch.mutate).toHaveBeenCalledTimes(1);
      expect(mockTrpcCloudTask.unwatch.mutate).toHaveBeenLastCalledWith({
        taskId: "task-123",
        runId: "run-123",
      });
    });

    it("merges model and effort options fetched from preview-config into the cloud session", async () => {
      const service = getSessionService();

      const sessionAfterInit = createMockSession({
        taskRunId: "run-model-123",
        taskId: "task-model-123",
        isCloud: true,
        configOptions: [
          {
            id: "mode",
            name: "Approval Preset",
            type: "select",
            category: "mode",
            currentValue: "plan",
            options: [],
          },
        ],
      });
      mockSessionStoreSetters.getSessions.mockReturnValue({
        "run-model-123": sessionAfterInit,
      });

      mockTrpcAgent.getPreviewConfigOptions.query.mockResolvedValueOnce([
        {
          id: "mode",
          name: "Approval Preset",
          type: "select",
          category: "mode",
          currentValue: "plan",
          options: [],
        },
        {
          id: "model",
          name: "Model",
          type: "select",
          category: "model",
          currentValue: "claude-opus-4-7",
          options: [
            { value: "claude-opus-4-7", name: "Opus 4.7" },
            { value: "claude-sonnet-4-6", name: "Sonnet 4.6" },
          ],
        },
        {
          id: "effort",
          name: "Effort",
          type: "select",
          category: "thought_level",
          currentValue: "high",
          options: [],
        },
      ]);

      service.watchCloudTask(
        "task-model-123",
        "run-model-123",
        "https://api.example.com",
        7,
        undefined,
        undefined,
        undefined,
        "claude",
        "claude-sonnet-4-6",
      );

      await vi.waitFor(() => {
        expect(
          mockTrpcAgent.getPreviewConfigOptions.query,
        ).toHaveBeenCalledWith({
          apiHost: "https://api.example.com",
          adapter: "claude",
        });
      });

      await vi.waitFor(() => {
        const calls = mockSessionStoreSetters.updateSession.mock.calls as Array<
          [string, { configOptions?: Array<{ id: string }> }]
        >;
        const modelUpdate = calls.find(
          ([runId, patch]) =>
            runId === "run-model-123" &&
            patch.configOptions?.some((o) => o.id === "model"),
        );
        expect(modelUpdate).toBeTruthy();
        const ids = modelUpdate?.[1].configOptions?.map((o) => o.id);
        expect(ids).toEqual(
          expect.arrayContaining(["mode", "model", "effort"]),
        );
        const modelOpt = modelUpdate?.[1].configOptions?.find(
          (o) => o.id === "model",
        ) as { currentValue?: string } | undefined;
        expect(modelOpt?.currentValue).toBe("claude-sonnet-4-6");
      });
    });

    it("retries an errored cloud watcher in place", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue({
        ...createMockSession({
          taskId: "task-123",
          taskRunId: "run-123",
          status: "error",
        }),
        isCloud: true,
      });

      await service.retryCloudTaskWatch("task-123");

      expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
        "run-123",
        expect.objectContaining({
          status: "disconnected",
          errorTitle: undefined,
          errorMessage: undefined,
          isPromptPending: false,
        }),
      );
      expect(mockTrpcCloudTask.retry.mutate).toHaveBeenCalledWith({
        taskId: "task-123",
        runId: "run-123",
      });
    });
  });

  describe("reset", () => {
    it("clears connecting tasks", () => {
      const service = getSessionService();
      // Access private map to verify it's cleared
      expect(() => service.reset()).not.toThrow();
    });

    it("unsubscribes from all active subscriptions", async () => {
      const service = getSessionService();

      // Setup: create mocks for subscriptions
      const eventUnsubscribe = vi.fn();
      const permissionUnsubscribe = vi.fn();
      mockTrpcAgent.onSessionEvent.subscribe.mockReturnValue({
        unsubscribe: eventUnsubscribe,
      });
      mockTrpcAgent.onPermissionRequest.subscribe.mockReturnValue({
        unsubscribe: permissionUnsubscribe,
      });

      // Setup: create a task run to trigger subscription creation
      const createTaskRunMock = vi.fn().mockResolvedValue({ id: "run-456" });
      mockAuth.fetchAuthState.mockResolvedValue({
        status: "authenticated",
        bootstrapComplete: true,
        cloudRegion: "us",
        projectId: 123,
        availableProjectIds: [123],
        availableOrgIds: [],
        hasCodeAccess: true,
        needsScopeReauth: false,
      });
      mockBuildAuthenticatedClient.mockReturnValue({
        ...mockAuthenticatedClient,
        createTaskRun: createTaskRunMock,
        appendTaskRunLog: vi.fn(),
      });
      mockTrpcAgent.start.mutate.mockResolvedValue({
        channel: "test-channel",
        configOptions: [],
      });

      // Connect to task (this creates subscriptions)
      await service.connectToTask({
        task: createMockTask({ id: "task-456" }),
        repoPath: "/repo",
      });

      // Verify subscriptions were created
      expect(mockTrpcAgent.onSessionEvent.subscribe).toHaveBeenCalled();
      expect(mockTrpcAgent.onPermissionRequest.subscribe).toHaveBeenCalled();

      // Reset the service
      service.reset();

      // Verify unsubscribe was called for both subscriptions
      expect(eventUnsubscribe).toHaveBeenCalled();
      expect(permissionUnsubscribe).toHaveBeenCalled();
    });
  });

  describe("sendPrompt", () => {
    it("throws when offline", async () => {
      mockGetIsOnline.mockReturnValue(false);
      const service = getSessionService();

      await expect(service.sendPrompt("task-123", "Hello")).rejects.toThrow(
        "No internet connection",
      );
    });

    it("throws when no session exists", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(undefined);

      await expect(service.sendPrompt("task-123", "Hello")).rejects.toThrow(
        "No active session for task",
      );
    });

    it("throws when session is in error state", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({
          status: "error",
          errorMessage: "Something went wrong",
        }),
      );

      await expect(service.sendPrompt("task-123", "Hello")).rejects.toThrow(
        "Something went wrong",
      );
    });

    it("throws when session is connecting", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({ status: "connecting" }),
      );

      await expect(service.sendPrompt("task-123", "Hello")).rejects.toThrow(
        "Session is still connecting",
      );
    });

    it("queues message when prompt is already pending", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({ isPromptPending: true }),
      );

      const result = await service.sendPrompt("task-123", "Hello");

      expect(result.stopReason).toBe("queued");
      expect(mockSessionStoreSetters.enqueueMessage).toHaveBeenCalledWith(
        "task-123",
        "Hello",
      );
    });

    it("queues message when compaction is in progress", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({ isCompacting: true }),
      );

      const result = await service.sendPrompt("task-123", "Hello");

      expect(result.stopReason).toBe("queued");
      expect(mockSessionStoreSetters.enqueueMessage).toHaveBeenCalledWith(
        "task-123",
        "Hello",
      );
    });

    it("queues cloud prompt when session.status is not connected (agent not ready)", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({
          isCloud: true,
          cloudStatus: "in_progress",
          status: "disconnected",
          isPromptPending: false,
        }),
      );

      const prompt: ContentBlock[] = [{ type: "text", text: "wake me up" }];
      const result = await service.sendPrompt("task-123", prompt);

      expect(result.stopReason).toBe("queued");
      expect(mockSessionStoreSetters.enqueueMessage).toHaveBeenCalledWith(
        "task-123",
        "wake me up",
        prompt,
      );
      expect(mockTrpcCloudTask.sendCommand.mutate).not.toHaveBeenCalled();
    });

    it("preserves cloud attachment prompts when queueing a follow-up", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({
          isCloud: true,
          cloudStatus: "in_progress",
          isPromptPending: true,
        }),
      );

      const prompt: ContentBlock[] = [
        { type: "text", text: "read this" },
        {
          type: "resource_link",
          uri: "file:///tmp/test.txt",
          name: "test.txt",
          mimeType: "text/plain",
        },
      ];

      const result = await service.sendPrompt("task-123", prompt);

      expect(result.stopReason).toBe("queued");
      expect(mockSessionStoreSetters.enqueueMessage).toHaveBeenCalledWith(
        "task-123",
        "read this\n\nAttached files: test.txt",
        prompt,
      );
    });

    it("sends prompt via tRPC when session is ready", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession(),
      );
      mockTrpcAgent.prompt.mutate.mockResolvedValue({ stopReason: "end_turn" });

      const result = await service.sendPrompt("task-123", "Hello");

      expect(result.stopReason).toBe("end_turn");
      expect(mockTrpcAgent.prompt.mutate).toHaveBeenCalledWith({
        sessionId: "run-123",
        prompt: [{ type: "text", text: "Hello" }],
      });
    });

    it("uploads attachments before sending cloud follow-ups", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({
          isCloud: true,
          cloudStatus: "in_progress",
        }),
      );
      mockTrpcCloudTask.sendCommand.mutate.mockResolvedValue({
        success: true,
        result: { queued: true },
      });
      mockTrpcFs.readFileAsBase64.query.mockResolvedValue("aGVsbG8=");
      mockAuthenticatedClient.prepareTaskRunArtifactUploads.mockResolvedValue([
        {
          id: "artifact-1",
          name: "test.txt",
          type: "user_attachment",
          source: "posthog_code",
          size: 5,
          content_type: "text/plain",
          storage_path: "tasks/artifacts/test.txt",
          expires_in: 3600,
          presigned_post: {
            url: "https://uploads.example.com",
            fields: { key: "tasks/artifacts/test.txt" },
          },
        },
      ]);
      mockAuthenticatedClient.finalizeTaskRunArtifactUploads.mockResolvedValue([
        {
          id: "artifact-1",
          name: "test.txt",
          type: "user_attachment",
          source: "posthog_code",
          size: 5,
          content_type: "text/plain",
          storage_path: "tasks/artifacts/test.txt",
          uploaded_at: "2026-04-16T00:00:00Z",
        },
      ]);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true } as Response),
      );

      const prompt: ContentBlock[] = [
        { type: "text", text: "read this" },
        {
          type: "resource_link",
          uri: "file:///tmp/test.txt",
          name: "test.txt",
          mimeType: "text/plain",
        },
      ];

      const result = await service.sendPrompt("task-123", prompt);

      expect(result.stopReason).toBe("queued");
      expect(mockTrpcCloudTask.sendCommand.mutate).toHaveBeenCalledTimes(1);
      expect(mockSessionStoreSetters.appendOptimisticItem).toHaveBeenCalledWith(
        "run-123",
        expect.objectContaining({
          type: "user_message",
          content: "read this\n\nAttached files: test.txt",
          pinToTop: false,
        }),
      );

      expect(mockTrpcCloudTask.sendCommand.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          params: {
            content: "read this",
            artifact_ids: ["artifact-1"],
          },
        }),
      );
    });

    it("preserves codex runtime selection when resuming a terminal cloud run", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({
          isCloud: true,
          cloudStatus: "completed",
          cloudBranch: "feature/codex-run",
          adapter: "codex",
          configOptions: [
            {
              id: "model",
              name: "Model",
              type: "select",
              category: "model",
              currentValue: "gpt-5.4",
              options: [],
            },
            {
              id: "effort",
              name: "Effort",
              type: "select",
              category: "thought_level",
              currentValue: "high",
              options: [],
            },
          ],
        }),
      );
      mockGetConfigOptionByCategory.mockImplementation(
        (
          configOptions: Array<{ category?: string }> | undefined,
          category?: string,
        ) => configOptions?.find((opt) => opt.category === category),
      );
      mockAuthenticatedClient.getTaskRun.mockResolvedValue({
        id: "run-123",
        task: "task-123",
        team: 123,
        branch: "feature/codex-run",
        runtime_adapter: "codex",
        model: "gpt-5.4",
        reasoning_effort: "high",
        environment: "cloud",
        status: "completed",
        log_url: "https://example.com/logs/run-123",
        error_message: null,
        output: {},
        state: {},
        created_at: "2026-04-14T00:00:00Z",
        updated_at: "2026-04-14T00:00:00Z",
        completed_at: "2026-04-14T00:05:00Z",
      });
      mockAuthenticatedClient.getTask.mockResolvedValue(createMockTask());
      mockAuthenticatedClient.runTaskInCloud.mockResolvedValue(
        createMockTask({
          latest_run: {
            id: "run-456",
            task: "task-123",
            team: 123,
            branch: "feature/codex-run",
            runtime_adapter: "codex",
            model: "gpt-5.4",
            reasoning_effort: "high",
            environment: "cloud",
            status: "queued",
            log_url: "https://example.com/logs/run-456",
            error_message: null,
            output: {},
            state: {},
            created_at: "2026-04-14T00:06:00Z",
            updated_at: "2026-04-14T00:06:00Z",
            completed_at: null,
          },
        }),
      );

      const result = await service.sendPrompt(
        "task-123",
        "Continue with Codex",
      );

      expect(result.stopReason).toBe("queued");
      expect(mockAuthenticatedClient.runTaskInCloud).toHaveBeenCalledWith(
        "task-123",
        "feature/codex-run",
        expect.objectContaining({
          adapter: "codex",
          model: "gpt-5.4",
          reasoningLevel: "high",
          resumeFromRunId: "run-123",
        }),
      );
    });

    it("preserves attachment blocks in the optimistic resume event", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({
          isCloud: true,
          cloudStatus: "completed",
          cloudBranch: "feature/cloud-run",
        }),
      );
      mockAuthenticatedClient.getTaskRun.mockResolvedValue({
        id: "run-123",
        task: "task-123",
        team: 123,
        branch: "feature/cloud-run",
        runtime_adapter: "claude",
        model: "claude-sonnet-4-20250514",
        reasoning_effort: null,
        environment: "cloud",
        status: "completed",
        log_url: "https://example.com/logs/run-123",
        error_message: null,
        output: {},
        state: {},
        created_at: "2026-04-14T00:00:00Z",
        updated_at: "2026-04-14T00:00:00Z",
        completed_at: "2026-04-14T00:05:00Z",
      });
      mockAuthenticatedClient.getTask.mockResolvedValue(createMockTask());
      mockTrpcFs.readFileAsBase64.query.mockResolvedValue("aGVsbG8=");
      mockAuthenticatedClient.prepareTaskStagedArtifactUploads.mockResolvedValue(
        [
          {
            id: "artifact-1",
            name: "test.txt",
            type: "user_attachment",
            source: "posthog_code",
            size: 5,
            content_type: "text/plain",
            storage_path: "tasks/artifacts/test.txt",
            expires_in: 3600,
            presigned_post: {
              url: "https://uploads.example.com",
              fields: { key: "tasks/artifacts/test.txt" },
            },
          },
        ],
      );
      mockAuthenticatedClient.finalizeTaskStagedArtifactUploads.mockResolvedValue(
        [
          {
            id: "artifact-1",
            name: "test.txt",
            type: "user_attachment",
            source: "posthog_code",
            size: 5,
            content_type: "text/plain",
            storage_path: "tasks/artifacts/test.txt",
            uploaded_at: "2026-04-16T00:00:00Z",
          },
        ],
      );
      mockAuthenticatedClient.runTaskInCloud.mockResolvedValue(
        createMockTask({
          latest_run: {
            id: "run-456",
            task: "task-123",
            team: 123,
            branch: "feature/cloud-run",
            runtime_adapter: "claude",
            model: "claude-sonnet-4-20250514",
            reasoning_effort: null,
            environment: "cloud",
            status: "queued",
            log_url: "https://example.com/logs/run-456",
            error_message: null,
            output: {},
            state: {},
            created_at: "2026-04-14T00:06:00Z",
            updated_at: "2026-04-14T00:06:00Z",
            completed_at: null,
          },
        }),
      );
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true } as Response),
      );

      const prompt: ContentBlock[] = [
        { type: "text", text: "what is this about?" },
        {
          type: "resource_link",
          uri: "file:///tmp/test.txt",
          name: "test.txt",
          mimeType: "text/plain",
        },
      ];

      const result = await service.sendPrompt("task-123", prompt);

      expect(result.stopReason).toBe("queued");
      expect(mockSessionStoreSetters.setSession).toHaveBeenCalledWith(
        expect.objectContaining({
          events: expect.arrayContaining([
            expect.objectContaining({
              message: expect.objectContaining({
                method: "session/prompt",
                params: {
                  prompt,
                },
              }),
            }),
          ]),
          skipPolledPromptCount: 1,
        }),
      );
    });

    const mockPreBootFailedSession = (overrides: Partial<AgentSession> = {}) =>
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({
          isCloud: true,
          cloudStatus: "failed",
          status: "disconnected",
          ...overrides,
        }),
      );

    it("refuses to resume when the previous run failed before the agent booted", async () => {
      const service = getSessionService();
      mockPreBootFailedSession({
        cloudErrorMessage: "Sandbox could not be provisioned",
      });

      await expect(service.sendPrompt("task-123", "retry?")).rejects.toThrow(
        "Sandbox could not be provisioned",
      );
      expect(mockAuthenticatedClient.runTaskInCloud).not.toHaveBeenCalled();
    });

    it("falls back to a generic message when the failed run has no error", async () => {
      const service = getSessionService();
      mockPreBootFailedSession();

      await expect(service.sendPrompt("task-123", "retry?")).rejects.toThrow(
        /Cloud run couldn't start/,
      );
      expect(mockAuthenticatedClient.runTaskInCloud).not.toHaveBeenCalled();
    });

    it("still resumes when a previously running agent failed mid-execution", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({
          isCloud: true,
          cloudStatus: "failed",
          status: "connected",
          cloudBranch: "feature/mid-run",
        }),
      );
      mockAuthenticatedClient.getTaskRun.mockResolvedValue({
        id: "run-123",
        task: "task-123",
        team: 123,
        branch: "feature/mid-run",
        runtime_adapter: "claude",
        model: "claude-sonnet-4-20250514",
        reasoning_effort: null,
        environment: "cloud",
        status: "failed",
        log_url: "https://example.com/logs/run-123",
        error_message: "agent crashed",
        output: {},
        state: {},
        created_at: "2026-04-14T00:00:00Z",
        updated_at: "2026-04-14T00:00:00Z",
        completed_at: "2026-04-14T00:05:00Z",
      });
      mockAuthenticatedClient.getTask.mockResolvedValue(createMockTask());
      mockAuthenticatedClient.runTaskInCloud.mockResolvedValue(
        createMockTask({
          latest_run: {
            id: "run-456",
            task: "task-123",
            team: 123,
            branch: "feature/mid-run",
            runtime_adapter: "claude",
            model: "claude-sonnet-4-20250514",
            reasoning_effort: null,
            environment: "cloud",
            status: "queued",
            log_url: "https://example.com/logs/run-456",
            error_message: null,
            output: {},
            state: {},
            created_at: "2026-04-14T00:06:00Z",
            updated_at: "2026-04-14T00:06:00Z",
            completed_at: null,
          },
        }),
      );

      const result = await service.sendPrompt("task-123", "try again");

      expect(result.stopReason).toBe("queued");
      expect(mockAuthenticatedClient.runTaskInCloud).toHaveBeenCalledTimes(1);
    });

    it("attempts automatic recovery on fatal error", async () => {
      const service = getSessionService();
      const mockSession = createMockSession({
        logUrl: "https://logs.example.com/run-123",
      });
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(mockSession);
      mockSessionStoreSetters.getSessions.mockReturnValue({
        "run-123": { ...mockSession, isPromptPending: false },
      });
      mockTrpcWorkspace.verify.query.mockResolvedValue({ exists: true });
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue("");
      mockTrpcAgent.reconnect.mutate.mockResolvedValue({
        sessionId: "run-123",
        channel: "agent-event:run-123",
        configOptions: [],
      });

      await service.connectToTask({
        task: createMockTask({
          latest_run: {
            id: "run-123",
            task: "task-123",
            team: 123,
            environment: "local",
            status: "in_progress",
            log_url: "https://logs.example.com/run-123",
            error_message: null,
            output: null,
            state: {},
            branch: null,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
            completed_at: null,
          },
        }),
        repoPath: "/repo",
      });

      mockTrpcAgent.prompt.mutate.mockRejectedValue(
        new Error("Internal error: process exited"),
      );

      await expect(service.sendPrompt("task-123", "Hello")).rejects.toThrow();
      expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
        "run-123",
        expect.objectContaining({
          status: "disconnected",
          errorMessage: expect.stringContaining("Reconnecting"),
        }),
      );
    });
  });

  describe("cancelPrompt", () => {
    it("returns false if no session exists", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(undefined);

      const result = await service.cancelPrompt("task-123");

      expect(result).toBe(false);
    });

    it("calls cancelPrompt mutation", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession(),
      );
      mockTrpcAgent.cancelPrompt.mutate.mockResolvedValue(true);

      const result = await service.cancelPrompt("task-123");

      expect(result).toBe(true);
      expect(mockTrpcAgent.cancelPrompt.mutate).toHaveBeenCalledWith({
        sessionId: "run-123",
      });
    });

    it("returns false on error", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession(),
      );
      mockTrpcAgent.cancelPrompt.mutate.mockRejectedValue(new Error("Failed"));

      const result = await service.cancelPrompt("task-123");

      expect(result).toBe(false);
    });
  });

  describe("respondToPermission", () => {
    it("does nothing if no session exists", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(undefined);

      await service.respondToPermission("task-123", "tool-1", "allow");

      expect(mockTrpcAgent.respondToPermission.mutate).not.toHaveBeenCalled();
    });

    it("removes permission from UI and sends response", async () => {
      const service = getSessionService();
      const permissions = new Map([["tool-1", { receivedAt: Date.now() }]]);
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({
          pendingPermissions: permissions as AgentSession["pendingPermissions"],
        }),
      );

      await service.respondToPermission("task-123", "tool-1", "allow");

      expect(mockSessionStoreSetters.setPendingPermissions).toHaveBeenCalled();
      expect(mockTrpcAgent.respondToPermission.mutate).toHaveBeenCalledWith({
        taskRunId: "run-123",
        toolCallId: "tool-1",
        optionId: "allow",
        customInput: undefined,
        answers: undefined,
      });
    });
  });

  describe("cancelPermission", () => {
    it("does nothing if no session exists", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(undefined);

      await service.cancelPermission("task-123", "tool-1");

      expect(mockTrpcAgent.cancelPermission.mutate).not.toHaveBeenCalled();
    });

    it("removes permission from UI and cancels", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession(),
      );

      await service.cancelPermission("task-123", "tool-1");

      expect(mockSessionStoreSetters.setPendingPermissions).toHaveBeenCalled();
      expect(mockTrpcAgent.cancelPermission.mutate).toHaveBeenCalledWith({
        taskRunId: "run-123",
        toolCallId: "tool-1",
      });
    });
  });

  describe("setSessionConfigOption", () => {
    it("does nothing if no session exists", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(undefined);

      await service.setSessionConfigOption(
        "task-123",
        "model",
        "claude-3-sonnet",
      );

      expect(mockTrpcAgent.setConfigOption.mutate).not.toHaveBeenCalled();
    });

    it("does nothing if config option not found", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({
          configOptions: [
            {
              id: "mode",
              name: "Mode",
              type: "select",
              category: "mode",
              currentValue: "default",
              options: [],
            },
          ],
        }),
      );

      await service.setSessionConfigOption(
        "task-123",
        "unknown-option",
        "value",
      );

      expect(mockTrpcAgent.setConfigOption.mutate).not.toHaveBeenCalled();
    });

    it("optimistically updates and calls API", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({
          configOptions: [
            {
              id: "model",
              name: "Model",
              type: "select",
              category: "model",
              currentValue: "claude-3-opus",
              options: [],
            },
          ],
        }),
      );

      await service.setSessionConfigOption(
        "task-123",
        "model",
        "claude-3-sonnet",
      );

      // Optimistic update
      expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
        "run-123",
        {
          configOptions: [
            {
              id: "model",
              name: "Model",
              type: "select",
              category: "model",
              currentValue: "claude-3-sonnet",
              options: [],
            },
          ],
        },
      );
      expect(
        mockSessionConfigStore.updatePersistedConfigOptionValue,
      ).toHaveBeenCalledWith("run-123", "model", "claude-3-sonnet");
      expect(mockTrpcAgent.setConfigOption.mutate).toHaveBeenCalledWith({
        sessionId: "run-123",
        configId: "model",
        value: "claude-3-sonnet",
      });
    });

    it("rolls back on API failure", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({
          configOptions: [
            {
              id: "mode",
              name: "Mode",
              type: "select",
              category: "mode",
              currentValue: "default",
              options: [],
            },
          ],
        }),
      );
      mockTrpcAgent.setConfigOption.mutate.mockRejectedValue(
        new Error("Failed"),
      );

      await service.setSessionConfigOption("task-123", "mode", "acceptEdits");

      // Should rollback
      expect(mockSessionStoreSetters.updateSession).toHaveBeenLastCalledWith(
        "run-123",
        {
          configOptions: [
            {
              id: "mode",
              name: "Mode",
              type: "select",
              category: "mode",
              currentValue: "default",
              options: [],
            },
          ],
        },
      );
      expect(
        mockSessionConfigStore.updatePersistedConfigOptionValue,
      ).toHaveBeenLastCalledWith("run-123", "mode", "default");
    });

    it("skips backend call when local session is idle-killed so reconnect restore handles it", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({
          status: "error",
          idleKilled: true,
          configOptions: [
            {
              id: "mode",
              name: "Mode",
              type: "select",
              category: "mode",
              currentValue: "default",
              options: [],
            },
          ],
        }),
      );

      await service.setSessionConfigOption("task-123", "mode", "acceptEdits");

      expect(mockTrpcAgent.setConfigOption.mutate).not.toHaveBeenCalled();
      expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledTimes(1);
      expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
        "run-123",
        {
          configOptions: [
            {
              id: "mode",
              name: "Mode",
              type: "select",
              category: "mode",
              currentValue: "acceptEdits",
              options: [],
            },
          ],
        },
      );
      expect(
        mockSessionConfigStore.updatePersistedConfigOptionValue,
      ).toHaveBeenCalledWith("run-123", "mode", "acceptEdits");
    });

    it("skips backend call when local session is reconnecting (disconnected status)", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({
          status: "disconnected",
          configOptions: [
            {
              id: "mode",
              name: "Mode",
              type: "select",
              category: "mode",
              currentValue: "default",
              options: [],
            },
          ],
        }),
      );

      await service.setSessionConfigOption("task-123", "mode", "acceptEdits");

      expect(mockTrpcAgent.setConfigOption.mutate).not.toHaveBeenCalled();
    });

    it("routes cloud sessions through sendCommand with set_config_option", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession({
          isCloud: true,
          cloudStatus: "in_progress",
          configOptions: [
            {
              id: "model",
              name: "Model",
              type: "select",
              category: "model",
              currentValue: "claude-opus-4-7",
              options: [],
            },
          ],
        }),
      );
      mockTrpcCloudTask.sendCommand.mutate.mockResolvedValue({
        success: true,
      });

      await service.setSessionConfigOption(
        "task-123",
        "model",
        "claude-sonnet-4-6",
      );

      expect(mockTrpcAgent.setConfigOption.mutate).not.toHaveBeenCalled();
      expect(mockTrpcCloudTask.sendCommand.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "set_config_option",
          params: { configId: "model", value: "claude-sonnet-4-6" },
        }),
      );
      expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
        "run-123",
        {
          configOptions: [
            {
              id: "model",
              name: "Model",
              type: "select",
              category: "model",
              currentValue: "claude-sonnet-4-6",
              options: [],
            },
          ],
        },
      );
    });
  });

  describe("clearSessionError", () => {
    it("cancels agent and reconnects in place (no teardown)", async () => {
      const service = getSessionService();
      const mockSession = createMockSession({
        status: "error",
        logUrl: "https://logs.example.com/run-123",
      });
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(mockSession);
      mockTrpcAgent.reconnect.mutate.mockResolvedValue({
        sessionId: "run-123",
        channel: "agent-event:run-123",
        configOptions: [],
      });
      mockTrpcAgent.onSessionEvent.subscribe.mockReturnValue({
        unsubscribe: vi.fn(),
      });
      mockTrpcAgent.onPermissionRequest.subscribe.mockReturnValue({
        unsubscribe: vi.fn(),
      });
      mockTrpcWorkspace.verify.query.mockResolvedValue({ exists: true });
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue("");

      await service.clearSessionError("task-123", "/repo");

      // Should cancel the backend agent
      expect(mockTrpcAgent.cancel.mutate).toHaveBeenCalledWith({
        sessionId: "run-123",
      });
      // Should NOT remove session from store (avoids connect effect loop)
      expect(mockSessionStoreSetters.removeSession).not.toHaveBeenCalled();
      // Should attempt reconnect in place
      expect(mockTrpcAgent.reconnect.mutate).toHaveBeenCalled();
    });

    it("creates fresh session when initialPrompt is set (prompt never delivered)", async () => {
      const service = getSessionService();
      const mockSession = createMockSession({
        status: "error",
        initialPrompt: [{ type: "text", text: "fix the bug" }],
      });
      // First call returns the error session, subsequent calls return connected
      mockSessionStoreSetters.getSessionByTaskId
        .mockReturnValueOnce(mockSession)
        .mockReturnValue(
          createMockSession({
            taskRunId: "new-run",
            status: "connected",
          }),
        );
      mockTrpcAgent.start.mutate.mockResolvedValue({
        channel: "agent-event:new-run",
        configOptions: [],
      });
      mockTrpcAgent.onSessionEvent.subscribe.mockReturnValue({
        unsubscribe: vi.fn(),
      });
      mockTrpcAgent.onPermissionRequest.subscribe.mockReturnValue({
        unsubscribe: vi.fn(),
      });
      mockTrpcAgent.prompt.mutate.mockResolvedValue({ stopReason: "end_turn" });
      mockBuildAuthenticatedClient.mockReturnValue({
        ...mockAuthenticatedClient,
        createTaskRun: vi.fn().mockResolvedValue({ id: "new-run" }),
        appendTaskRunLog: vi.fn(),
      });

      await service.clearSessionError("task-123", "/repo");

      // Should tear down old session and create a new one
      expect(mockTrpcAgent.cancel.mutate).toHaveBeenCalledWith({
        sessionId: "run-123",
      });
      expect(mockTrpcAgent.start.mutate).toHaveBeenCalled();
    });

    it("handles missing session gracefully", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(undefined);

      await expect(
        service.clearSessionError("task-123", "/repo"),
      ).resolves.not.toThrow();
    });
  });

  describe("handoffToCloud", () => {
    it("starts GitHub reauth when cloud handoff needs user authorization", async () => {
      const service = getSessionService();
      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(
        createMockSession(),
      );
      mockTrpcHandoff.executeToCloud.mutate.mockResolvedValue({
        success: false,
        code: "github_authorization_required",
        error: "Connect GitHub in your browser, then retry Continue in cloud.",
      });

      await service.handoffToCloud("task-123", "/repo/path");

      expect(
        mockAuthenticatedClient.startGithubUserIntegrationConnect,
      ).toHaveBeenCalledWith(123);
      expect(mockTrpcOs.openExternal.mutate).toHaveBeenCalledWith({
        url: "https://github.com/login/oauth/authorize",
      });
      expect(toast.info).toHaveBeenCalledWith(
        "Connect GitHub to continue in cloud",
        "Complete the authorization in your browser, then click Continue again.",
      );
      expect(toast.error).not.toHaveBeenCalledWith(
        expect.stringContaining("github_authorization_required"),
      );
      expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
        "run-123",
        {
          handoffInProgress: false,
          status: "disconnected",
        },
      );
    });
  });

  describe("automatic local recovery", () => {
    it("reconnects automatically after a subscription error", async () => {
      vi.useFakeTimers();
      const service = getSessionService();
      const mockSession = createMockSession({
        status: "connected",
        logUrl: "https://logs.example.com/run-123",
      });

      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(mockSession);
      mockSessionStoreSetters.getSessions.mockReturnValue({
        "run-123": mockSession,
      });
      mockTrpcWorkspace.verify.query.mockResolvedValue({ exists: true });
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue("");
      mockTrpcAgent.reconnect.mutate.mockResolvedValue({
        sessionId: "run-123",
        channel: "agent-event:run-123",
        configOptions: [],
      });

      await service.clearSessionError("task-123", "/repo");

      const onError = mockTrpcAgent.onSessionEvent.subscribe.mock.calls[0]?.[1]
        ?.onError as ((error: Error) => void) | undefined;
      expect(onError).toBeDefined();

      onError?.(new Error("connection dropped"));
      await vi.runAllTimersAsync();

      expect(mockTrpcAgent.reconnect.mutate).toHaveBeenCalledTimes(2);
      expect(mockSessionStoreSetters.updateSession).toHaveBeenCalledWith(
        "run-123",
        expect.objectContaining({
          status: "disconnected",
          errorMessage: expect.stringContaining("Reconnecting"),
        }),
      );

      vi.useRealTimers();
    });

    it("shows the error screen only after automatic reconnect attempts fail", async () => {
      vi.useFakeTimers();
      const service = getSessionService();
      const mockSession = createMockSession({
        status: "connected",
        logUrl: "https://logs.example.com/run-123",
      });

      mockSessionStoreSetters.getSessionByTaskId.mockReturnValue(mockSession);
      mockSessionStoreSetters.getSessions.mockReturnValue({
        "run-123": mockSession,
      });
      mockTrpcWorkspace.verify.query.mockResolvedValue({ exists: true });
      mockTrpcLogs.readLocalLogs.query.mockResolvedValue("");
      mockTrpcAgent.reconnect.mutate
        .mockResolvedValueOnce({
          sessionId: "run-123",
          channel: "agent-event:run-123",
          configOptions: [],
        })
        .mockResolvedValue(null);

      await service.clearSessionError("task-123", "/repo");

      const onError = mockTrpcAgent.onSessionEvent.subscribe.mock.calls[0]?.[1]
        ?.onError as ((error: Error) => void) | undefined;
      expect(onError).toBeDefined();

      onError?.(new Error("connection dropped"));
      await vi.runAllTimersAsync();

      expect(mockTrpcAgent.reconnect.mutate).toHaveBeenCalledTimes(4);
      expect(mockSessionStoreSetters.setSession).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
          errorTitle: "Connection lost",
          errorMessage: expect.any(String),
        }),
      );

      vi.useRealTimers();
    });
  });
});
