import type { RootLogger } from "@posthog/di/logger";
import type { IPowerManager } from "@posthog/platform/power-manager";
import { OAUTH_SCOPE_VERSION } from "@posthog/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth";
import type {
  AuthOrgProjectPreferenceRecord,
  AuthPreferenceRecord,
  AuthSessionRecord,
  ConnectivityStatus,
  IAuthConnectivity,
  IAuthOAuthFlowService,
  IAuthPreferenceStore,
  IAuthSessionStore,
  IAuthTokenCipher,
  PersistAuthSessionRecord,
} from "./identifiers";

vi.mock("@posthog/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@posthog/shared")>();
  return {
    ...actual,
    sleepWithBackoff: vi.fn().mockResolvedValue(undefined),
  };
});

const mockPowerManager = vi.hoisted(() => ({
  onResume: vi.fn(() => () => {}),
  preventSleep: vi.fn(() => () => {}),
}));

function createSessionPort(): IAuthSessionStore {
  let current: AuthSessionRecord | null = null;
  return {
    getCurrent: () => (current ? { ...current } : null),
    saveCurrent: (input: PersistAuthSessionRecord) => {
      current = { ...input };
    },
    clearCurrent: () => {
      current = null;
    },
  };
}

function createPreferencePort(): IAuthPreferenceStore {
  const store = new Map<string, AuthPreferenceRecord>();
  const orgProjectStore = new Map<string, AuthOrgProjectPreferenceRecord>();
  return {
    get: (accountKey, cloudRegion) =>
      store.get(`${accountKey}:${cloudRegion}`) ?? null,
    save: (input) => {
      store.set(`${input.accountKey}:${input.cloudRegion}`, { ...input });
    },
    getOrgProject: (accountKey, cloudRegion, orgId) =>
      orgProjectStore.get(`${accountKey}:${cloudRegion}:${orgId}`) ?? null,
    saveOrgProject: (input) => {
      orgProjectStore.set(
        `${input.accountKey}:${input.cloudRegion}:${input.orgId}`,
        { ...input },
      );
    },
  };
}

const identityCipher: IAuthTokenCipher = {
  encrypt: (plaintext) => plaintext,
  decrypt: (encrypted) => encrypted,
};

const mockLogger: RootLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  scope: vi.fn(() => mockLogger),
};

function mockTokenResponse(
  overrides: {
    accessToken?: string;
    refreshToken?: string;
    scopedOrgs?: string[];
  } = {},
) {
  return {
    success: true as const,
    data: {
      access_token: overrides.accessToken ?? "access-token",
      refresh_token: overrides.refreshToken ?? "refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "",
      scoped_organizations: overrides.scopedOrgs ?? ["org-1"],
    },
  };
}

describe("AuthService", () => {
  let sessionPort: IAuthSessionStore;
  let preferencePort: IAuthPreferenceStore;

  const oauthFlow = {
    refreshToken: vi.fn(),
    startFlow: vi.fn(),
    startSignupFlow: vi.fn(),
    cancelFlow: vi.fn(),
  };

  let connectivityHandler: ((status: ConnectivityStatus) => void) | null = null;
  const connectivity: IAuthConnectivity = {
    getStatus: vi.fn(() => ({ isOnline: true })),
    onStatusChange: vi.fn((handler) => {
      connectivityHandler = handler;
      return () => {
        connectivityHandler = null;
      };
    }),
  };

  let service: AuthService;

  function seedStoredSession(
    overrides: {
      refreshToken?: string;
      selectedProjectId?: number | null;
      scopeVersion?: number;
    } = {},
  ) {
    sessionPort.saveCurrent({
      refreshTokenEncrypted: overrides.refreshToken ?? "stored-refresh-token",
      cloudRegion: "us",
      selectedProjectId: overrides.selectedProjectId ?? null,
      scopeVersion: overrides.scopeVersion ?? OAUTH_SCOPE_VERSION,
    });
  }

  function emitStatus(isOnline: boolean) {
    connectivityHandler?.({ isOnline });
  }

  function getResumeHandler(): () => void {
    const call = mockPowerManager.onResume.mock.calls[0];
    return (call as unknown as [() => void])[0];
  }

  const stubAuthFetch = (
    options: {
      accountKey?: string;
      currentOrgId?: string;
      orgs?: Record<
        string,
        { name: string; projects: { id: number; name: string }[] }
      >;
    } = {},
  ) => {
    const accountKey = options.accountKey ?? "user-1";
    const currentOrgId = options.currentOrgId ?? "org-1";
    const orgs = options.orgs ?? {
      "org-1": { name: "Org 1", projects: [{ id: 42, name: "Project 42" }] },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | Request) => {
        const url = typeof input === "string" ? input : input.url;

        if (url.includes("/api/users/@me/")) {
          return {
            ok: true,
            json: vi.fn().mockResolvedValue({
              uuid: accountKey,
              organization: { id: currentOrgId },
            }),
          } as unknown as Response;
        }

        const orgMatch = url.match(/\/api\/organizations\/([^/]+)\/$/);
        if (orgMatch) {
          const orgId = orgMatch[1];
          return {
            ok: true,
            json: vi.fn().mockResolvedValue({
              name: orgs[orgId]?.name ?? "Unknown",
              teams: orgs[orgId]?.projects ?? [],
            }),
          } as unknown as Response;
        }

        return {
          ok: true,
          json: vi.fn().mockResolvedValue({ has_access: true }),
        } as unknown as Response;
      }) as unknown as typeof fetch,
    );
  };

  function createService(): AuthService {
    return new AuthService(
      preferencePort,
      sessionPort,
      oauthFlow as unknown as IAuthOAuthFlowService,
      connectivity,
      identityCipher,
      mockPowerManager as unknown as IPowerManager,
      mockLogger,
      null,
    );
  }

  beforeEach(() => {
    sessionPort = createSessionPort();
    preferencePort = createPreferencePort();
    vi.clearAllMocks();
    connectivityHandler = null;
    vi.mocked(connectivity.getStatus).mockReturnValue({ isOnline: true });
    service = createService();
    service.init();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    service.shutdown();
    await service.logout();
  });

  it("bootstraps to anonymous when there is no stored session", async () => {
    await service.initialize();

    expect(service.getState()).toEqual({
      status: "anonymous",
      bootstrapComplete: true,
      cloudRegion: null,
      orgProjectsMap: {},
      currentOrgId: null,
      currentProjectId: null,
      hasCodeAccess: null,
      needsScopeReauth: false,
    });
  });

  it("requires scope reauthentication when the stored scope version is stale", async () => {
    seedStoredSession({
      refreshToken: "refresh-token",
      selectedProjectId: 123,
      scopeVersion: OAUTH_SCOPE_VERSION - 1,
    });

    await service.initialize();

    expect(service.getState()).toEqual({
      status: "anonymous",
      bootstrapComplete: true,
      cloudRegion: "us",
      orgProjectsMap: {},
      currentOrgId: null,
      currentProjectId: 123,
      hasCodeAccess: null,
      needsScopeReauth: true,
    });
  });

  it("restores an authenticated session by refreshing the stored refresh token", async () => {
    seedStoredSession({ selectedProjectId: 42 });
    oauthFlow.refreshToken.mockResolvedValue(
      mockTokenResponse({
        accessToken: "new-access-token",
        refreshToken: "rotated-refresh-token",
      }),
    );
    stubAuthFetch({
      orgs: {
        "org-1": {
          name: "Org 1",
          projects: [
            { id: 42, name: "Project 42" },
            { id: 84, name: "Project 84" },
          ],
        },
      },
    });

    await service.initialize();

    expect(service.getState()).toMatchObject({
      status: "authenticated",
      bootstrapComplete: true,
      cloudRegion: "us",
      orgProjectsMap: {
        "org-1": {
          orgName: "Org 1",
          projects: [
            { id: 42, name: "Project 42" },
            { id: 84, name: "Project 84" },
          ],
        },
      },
      currentOrgId: "org-1",
      currentProjectId: 42,
      hasCodeAccess: true,
      needsScopeReauth: false,
    });

    expect(sessionPort.getCurrent()?.refreshTokenEncrypted).toBe(
      "rotated-refresh-token",
    );
  });

  it("keeps bootstrap restoring when the stored-session restore hangs", async () => {
    vi.useFakeTimers();
    try {
      seedStoredSession({ selectedProjectId: 42 });
      stubAuthFetch();
      // Half-open socket: the refresh never resolves or rejects.
      oauthFlow.refreshToken.mockReturnValue(new Promise<never>(() => {}));

      const initPromise = service.initialize();
      await vi.advanceTimersByTimeAsync(20_001);
      await initPromise;

      expect(service.getState()).toMatchObject({
        status: "restoring",
        bootstrapComplete: false,
        cloudRegion: "us",
        currentProjectId: 42,
      });
      expect(sessionPort.getCurrent()).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("upgrades to authenticated when the slow restore lands after the deadline", async () => {
    vi.useFakeTimers();
    try {
      seedStoredSession({ selectedProjectId: 42 });
      stubAuthFetch();
      let resolveRefresh!: (value: unknown) => void;
      oauthFlow.refreshToken.mockReturnValue(
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
      );

      const initPromise = service.initialize();
      await vi.advanceTimersByTimeAsync(20_001);
      await initPromise;

      expect(service.getState().status).toBe("restoring");

      resolveRefresh(
        mockTokenResponse({
          accessToken: "late-access-token",
          refreshToken: "late-refresh-token",
        }),
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(service.getState()).toMatchObject({
        status: "authenticated",
        bootstrapComplete: true,
        currentProjectId: 42,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares the in-flight bootstrap refresh with token callers after the deadline", async () => {
    vi.useFakeTimers();
    try {
      seedStoredSession({ selectedProjectId: 42 });
      stubAuthFetch();
      let resolveRefresh!: (value: unknown) => void;
      oauthFlow.refreshToken.mockReturnValue(
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
      );

      const initPromise = service.initialize();
      await vi.advanceTimersByTimeAsync(20_001);
      await initPromise;

      expect(service.getState().status).toBe("restoring");

      const tokenPromise = service.getValidAccessToken();
      await vi.advanceTimersByTimeAsync(0);
      expect(oauthFlow.refreshToken).toHaveBeenCalledTimes(1);

      resolveRefresh(
        mockTokenResponse({
          accessToken: "late-access-token",
          refreshToken: "late-refresh-token",
        }),
      );

      await expect(tokenPromise).resolves.toMatchObject({
        accessToken: "late-access-token",
      });
      expect(oauthFlow.refreshToken).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forces a token refresh when explicitly requested", async () => {
    oauthFlow.startFlow.mockResolvedValue(
      mockTokenResponse({
        accessToken: "initial-access-token",
        refreshToken: "initial-refresh-token",
      }),
    );
    oauthFlow.refreshToken.mockResolvedValue(
      mockTokenResponse({
        accessToken: "refreshed-access-token",
        refreshToken: "rotated-refresh-token",
      }),
    );
    stubAuthFetch();

    await service.login("us");
    const token = await service.refreshAccessToken();

    expect(token.accessToken).toBe("refreshed-access-token");
    expect(oauthFlow.refreshToken).toHaveBeenCalledWith(
      "initial-refresh-token",
      "us",
    );
    expect(sessionPort.getCurrent()?.refreshTokenEncrypted).toBe(
      "rotated-refresh-token",
    );
  });

  it("preserves the selected project across logout and re-login for the same account", async () => {
    const orgs = {
      "org-1": {
        name: "Org 1",
        projects: [
          { id: 42, name: "Project 42" },
          { id: 84, name: "Project 84" },
        ],
      },
    };
    oauthFlow.startFlow
      .mockResolvedValueOnce(
        mockTokenResponse({
          accessToken: "initial-access-token",
          refreshToken: "initial-refresh-token",
        }),
      )
      .mockResolvedValueOnce(
        mockTokenResponse({
          accessToken: "second-access-token",
          refreshToken: "second-refresh-token",
        }),
      );
    oauthFlow.refreshToken.mockResolvedValue(
      mockTokenResponse({
        accessToken: "refreshed-access-token",
        refreshToken: "refreshed-refresh-token",
      }),
    );
    stubAuthFetch({ orgs });

    await service.login("us");
    await service.selectProject(84);
    await service.logout();

    expect(service.getState()).toMatchObject({
      status: "anonymous",
      cloudRegion: "us",
      currentProjectId: 84,
    });

    await service.login("us");

    expect(service.getState()).toMatchObject({
      status: "authenticated",
      cloudRegion: "us",
      currentProjectId: 84,
      orgProjectsMap: {
        "org-1": {
          orgName: "Org 1",
          projects: [
            { id: 42, name: "Project 42" },
            { id: 84, name: "Project 84" },
          ],
        },
      },
    });
  });

  it("restores the selected project after app restart while logged out", async () => {
    const orgs = {
      "org-1": {
        name: "Org 1",
        projects: [
          { id: 42, name: "Project 42" },
          { id: 84, name: "Project 84" },
        ],
      },
    };
    oauthFlow.startFlow
      .mockResolvedValueOnce(
        mockTokenResponse({
          accessToken: "initial-access-token",
          refreshToken: "initial-refresh-token",
        }),
      )
      .mockResolvedValueOnce(
        mockTokenResponse({
          accessToken: "second-access-token",
          refreshToken: "second-refresh-token",
        }),
      );
    oauthFlow.refreshToken.mockResolvedValue(
      mockTokenResponse({
        accessToken: "refreshed-access-token",
        refreshToken: "refreshed-refresh-token",
      }),
    );
    stubAuthFetch({ orgs });

    await service.login("us");
    await service.selectProject(84);
    await service.logout();

    service = createService();

    await service.login("us");

    expect(service.getState()).toMatchObject({
      status: "authenticated",
      cloudRegion: "us",
      currentProjectId: 84,
      orgProjectsMap: {
        "org-1": {
          orgName: "Org 1",
          projects: [
            { id: 42, name: "Project 42" },
            { id: 84, name: "Project 84" },
          ],
        },
      },
    });
  });

  describe("lifecycle: connectivity recovery", () => {
    it("recovers session when connectivity changes to online", async () => {
      seedStoredSession({ selectedProjectId: 42 });
      vi.mocked(connectivity.getStatus).mockReturnValue({ isOnline: false });
      await service.initialize();
      expect(service.getState().status).toBe("restoring");

      vi.mocked(connectivity.getStatus).mockReturnValue({ isOnline: true });
      oauthFlow.refreshToken.mockResolvedValue(mockTokenResponse());
      stubAuthFetch();

      emitStatus(true);

      await vi.waitFor(() => {
        expect(service.getState().status).toBe("authenticated");
      });
    });

    it("does nothing when session already exists", async () => {
      oauthFlow.startFlow.mockResolvedValue(mockTokenResponse());
      stubAuthFetch();
      await service.login("us");
      oauthFlow.refreshToken.mockClear();

      emitStatus(true);

      await new Promise((r) => setTimeout(r, 10));
      expect(oauthFlow.refreshToken).not.toHaveBeenCalled();
    });

    it("ignores offline events", async () => {
      seedStoredSession();

      emitStatus(false);

      await new Promise((r) => setTimeout(r, 10));
      expect(oauthFlow.refreshToken).not.toHaveBeenCalled();
    });

    it("deduplicates concurrent recovery attempts", async () => {
      seedStoredSession();

      let resolveRefresh!: () => void;
      oauthFlow.refreshToken.mockReturnValue(
        new Promise((resolve) => {
          resolveRefresh = () => resolve(mockTokenResponse());
        }),
      );
      stubAuthFetch();

      emitStatus(true);
      emitStatus(true);

      await new Promise((r) => setTimeout(r, 10));
      expect(oauthFlow.refreshToken).toHaveBeenCalledTimes(1);

      resolveRefresh();

      await vi.waitFor(() => {
        expect(service.getState().status).toBe("authenticated");
      });
    });
  });

  describe("lifecycle: power monitor resume", () => {
    it("registers and unregisters the resume handler", () => {
      expect(mockPowerManager.onResume).toHaveBeenCalledWith(
        expect.any(Function),
      );
      const unsubscribe = mockPowerManager.onResume.mock.results[0]?.value as
        | (() => void)
        | undefined;

      service.shutdown();
      expect(unsubscribe).toBeDefined();
    });

    it("attempts session recovery on resume", async () => {
      seedStoredSession();
      oauthFlow.refreshToken.mockResolvedValue(mockTokenResponse());
      stubAuthFetch();

      getResumeHandler()();

      await vi.waitFor(() => {
        expect(service.getState().status).toBe("authenticated");
      });
    });
  });

  describe("refresh retry with error codes", () => {
    it.each([
      { errorCode: "network_error" as const, label: "network_error" },
      { errorCode: "server_error" as const, label: "server_error" },
    ])(
      "retries on $label and succeeds on second attempt",
      async ({ errorCode }) => {
        seedStoredSession();
        oauthFlow.refreshToken
          .mockResolvedValueOnce({
            success: false,
            error: "Transient failure",
            errorCode,
          })
          .mockResolvedValueOnce(mockTokenResponse());
        stubAuthFetch();

        await service.initialize();

        expect(service.getState().status).toBe("authenticated");
        expect(oauthFlow.refreshToken).toHaveBeenCalledTimes(2);
      },
    );

    it("does not retry on auth_error and forces logout", async () => {
      seedStoredSession({ selectedProjectId: 42 });
      oauthFlow.refreshToken.mockResolvedValue({
        success: false,
        error: "Token revoked",
        errorCode: "auth_error",
      });

      await service.initialize();

      expect(service.getState()).toMatchObject({
        status: "anonymous",
        cloudRegion: "us",
        currentProjectId: 42,
      });
      expect(oauthFlow.refreshToken).toHaveBeenCalledTimes(1);
      expect(sessionPort.getCurrent()).toBeNull();
    });

    it("keeps restoring after a non-retryable unknown_error", async () => {
      seedStoredSession();
      oauthFlow.refreshToken.mockResolvedValue({
        success: false,
        error: "Something weird",
        errorCode: "unknown_error",
      });

      await service.initialize();

      expect(service.getState().status).toBe("restoring");
      expect(oauthFlow.refreshToken).toHaveBeenCalledTimes(1);
    });

    it("gives up after all retry attempts are exhausted", async () => {
      seedStoredSession();
      oauthFlow.refreshToken.mockResolvedValue({
        success: false,
        error: "Network error",
        errorCode: "network_error",
      });

      await service.initialize();

      expect(service.getState().status).toBe("restoring");
      expect(oauthFlow.refreshToken).toHaveBeenCalledTimes(3);
    });
  });

  describe("transient org fetch failures", () => {
    it("retries the org fetch on a transient network failure and keeps the selected project", async () => {
      seedStoredSession({ selectedProjectId: 84 });
      oauthFlow.refreshToken.mockResolvedValue(mockTokenResponse());

      let orgCallCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | Request) => {
          const url = typeof input === "string" ? input : input.url;

          if (url.includes("/api/users/@me/")) {
            return {
              ok: true,
              json: vi.fn().mockResolvedValue({
                uuid: "user-1",
                organization: { id: "org-1" },
              }),
            } as unknown as Response;
          }

          if (/\/api\/organizations\/[^/]+\/$/.test(url)) {
            orgCallCount++;
            if (orgCallCount === 1) {
              throw new TypeError("fetch failed");
            }
            return {
              ok: true,
              json: vi.fn().mockResolvedValue({
                name: "Org 1",
                teams: [
                  { id: 42, name: "Project 42" },
                  { id: 84, name: "Project 84" },
                ],
              }),
            } as unknown as Response;
          }

          return {
            ok: true,
            json: vi.fn().mockResolvedValue({ has_access: true }),
          } as unknown as Response;
        }) as unknown as typeof fetch,
      );

      await service.initialize();

      expect(orgCallCount).toBe(2);
      expect(service.getState()).toMatchObject({
        status: "authenticated",
        currentProjectId: 84,
        orgProjectsMap: {
          "org-1": {
            orgName: "Org 1",
            projects: [
              { id: 42, name: "Project 42" },
              { id: 84, name: "Project 84" },
            ],
          },
        },
      });
    });

    it("preserves previously-known projects and the selected project when the org fetch fails on refresh", async () => {
      const orgs = {
        "org-1": {
          name: "Org 1",
          projects: [
            { id: 42, name: "Project 42" },
            { id: 84, name: "Project 84" },
          ],
        },
      };
      oauthFlow.startFlow.mockResolvedValue(mockTokenResponse());
      oauthFlow.refreshToken.mockResolvedValue(mockTokenResponse());
      stubAuthFetch({ orgs });

      await service.login("us");
      await service.selectProject(84);

      let orgCallCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | Request) => {
          const url = typeof input === "string" ? input : input.url;

          if (url.includes("/api/users/@me/")) {
            return {
              ok: true,
              json: vi.fn().mockResolvedValue({
                uuid: "user-1",
                organization: { id: "org-1" },
              }),
            } as unknown as Response;
          }

          if (/\/api\/organizations\/[^/]+\/$/.test(url)) {
            orgCallCount++;
            throw new TypeError("fetch failed");
          }

          return {
            ok: true,
            json: vi.fn().mockResolvedValue({ has_access: true }),
          } as unknown as Response;
        }) as unknown as typeof fetch,
      );

      await service.refreshAccessToken();

      expect(orgCallCount).toBe(3);
      expect(service.getState()).toMatchObject({
        status: "authenticated",
        currentProjectId: 84,
        orgProjectsMap: {
          "org-1": {
            orgName: "Org 1",
            projects: [
              { id: 42, name: "Project 42" },
              { id: 84, name: "Project 84" },
            ],
          },
        },
      });
    });

    it("does not retry org fetch on a 4xx response", async () => {
      seedStoredSession({ selectedProjectId: 84 });
      oauthFlow.refreshToken.mockResolvedValue(mockTokenResponse());

      let orgCallCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | Request) => {
          const url = typeof input === "string" ? input : input.url;

          if (url.includes("/api/users/@me/")) {
            return {
              ok: true,
              json: vi.fn().mockResolvedValue({
                uuid: "user-1",
                organization: { id: "org-1" },
              }),
            } as unknown as Response;
          }

          if (/\/api\/organizations\/[^/]+\/$/.test(url)) {
            orgCallCount++;
            return {
              ok: false,
              status: 403,
              json: vi.fn().mockResolvedValue({}),
            } as unknown as Response;
          }

          return {
            ok: true,
            json: vi.fn().mockResolvedValue({ has_access: true }),
          } as unknown as Response;
        }) as unknown as typeof fetch,
      );

      await service.initialize();

      expect(orgCallCount).toBe(1);
    });
  });

  describe("project-less recovery", () => {
    function stubOrgFetch(state: { succeeds: boolean; orgCalls: number }) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | Request) => {
          const url = typeof input === "string" ? input : input.url;

          if (url.includes("/api/users/@me/")) {
            return {
              ok: true,
              json: vi.fn().mockResolvedValue({
                uuid: "user-1",
                organization: { id: "org-1" },
              }),
            } as unknown as Response;
          }

          if (/\/api\/organizations\/[^/]+\/$/.test(url)) {
            state.orgCalls++;
            if (!state.succeeds) {
              throw new TypeError("fetch failed");
            }
            return {
              ok: true,
              json: vi.fn().mockResolvedValue({
                name: "Org 1",
                teams: [
                  { id: 42, name: "Project 42" },
                  { id: 84, name: "Project 84" },
                ],
              }),
            } as unknown as Response;
          }

          return {
            ok: true,
            json: vi.fn().mockResolvedValue({ has_access: true }),
          } as unknown as Response;
        }) as unknown as typeof fetch,
      );
    }

    // Let the fire-and-forget refreshOrgProjects() that syncAuthenticatedSession
    // kicks settle (it no-ops while offline) so orgProjectsRefreshPromise is cleared
    // before we trigger recovery explicitly.
    const flushPostSyncKick = () => new Promise((r) => setTimeout(r, 0));

    it.each([
      {
        trigger: "connectivity online",
        seedProjectId: 84,
        expectProjectId: 84,
      },
      {
        trigger: "power-monitor resume",
        seedProjectId: null,
        expectProjectId: 42,
      },
    ])(
      "authenticates without a project on transient org failure, then recovers via $trigger",
      async ({ trigger, seedProjectId, expectProjectId }) => {
        if (seedProjectId !== null) {
          seedStoredSession({
            selectedProjectId: seedProjectId,
            scopeVersion: OAUTH_SCOPE_VERSION - 1,
          });
          await service.initialize();
        }

        const fetchState = { succeeds: false, orgCalls: 0 };
        stubOrgFetch(fetchState);
        oauthFlow.startFlow.mockResolvedValue(mockTokenResponse());
        vi.mocked(connectivity.getStatus).mockReturnValue({ isOnline: false });

        await service.login("us");

        expect(service.getState()).toMatchObject({
          status: "authenticated",
          currentProjectId: null,
          orgProjectsMap: { "org-1": { projects: [] } },
        });

        await flushPostSyncKick();

        fetchState.succeeds = true;
        vi.mocked(connectivity.getStatus).mockReturnValue({ isOnline: true });
        if (trigger === "connectivity online") {
          emitStatus(true);
        } else {
          getResumeHandler()();
        }

        await vi.waitFor(() => {
          expect(service.getState().currentProjectId).toBe(expectProjectId);
        });
        expect(service.getState().orgProjectsMap).toMatchObject({
          "org-1": {
            orgName: "Org 1",
            projects: [
              { id: 42, name: "Project 42" },
              { id: 84, name: "Project 84" },
            ],
          },
        });
      },
    );

    it("retries across multiple recovery passes before succeeding", async () => {
      let orgCalls = 0;
      let succeedFromCall = Number.POSITIVE_INFINITY;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | Request) => {
          const url = typeof input === "string" ? input : input.url;
          if (url.includes("/api/users/@me/")) {
            return {
              ok: true,
              json: vi.fn().mockResolvedValue({
                uuid: "user-1",
                organization: { id: "org-1" },
              }),
            } as unknown as Response;
          }
          if (/\/api\/organizations\/[^/]+\/$/.test(url)) {
            orgCalls++;
            if (orgCalls < succeedFromCall) {
              throw new TypeError("fetch failed");
            }
            return {
              ok: true,
              json: vi.fn().mockResolvedValue({
                name: "Org 1",
                teams: [{ id: 42, name: "Project 42" }],
              }),
            } as unknown as Response;
          }
          return {
            ok: true,
            json: vi.fn().mockResolvedValue({ has_access: true }),
          } as unknown as Response;
        }) as unknown as typeof fetch,
      );
      oauthFlow.startFlow.mockResolvedValue(mockTokenResponse());
      vi.mocked(connectivity.getStatus).mockReturnValue({ isOnline: false });

      await service.login("us");
      expect(service.getState().currentProjectId).toBeNull();
      await flushPostSyncKick();

      // Two recovery passes fail (3 org-fetch attempts each); the third succeeds.
      orgCalls = 0;
      succeedFromCall = 7;
      vi.mocked(connectivity.getStatus).mockReturnValue({ isOnline: true });
      emitStatus(true);

      await vi.waitFor(() => {
        expect(service.getState().currentProjectId).toBe(42);
      });
      expect(orgCalls).toBe(7);
    });

    it("stays project-less without crashing when recovery exhausts every attempt", async () => {
      const fetchState = { succeeds: false, orgCalls: 0 };
      stubOrgFetch(fetchState);
      oauthFlow.startFlow.mockResolvedValue(mockTokenResponse());
      vi.mocked(connectivity.getStatus).mockReturnValue({ isOnline: false });

      await service.login("us");
      await flushPostSyncKick();

      fetchState.orgCalls = 0;
      vi.mocked(connectivity.getStatus).mockReturnValue({ isOnline: true });
      emitStatus(true);

      // 5 recovery passes x 3 org-fetch attempts each.
      await vi.waitFor(() => {
        expect(fetchState.orgCalls).toBe(15);
      });
      expect(service.getState()).toMatchObject({
        status: "authenticated",
        currentProjectId: null,
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Org/projects recovery exhausted retries",
      );
    });

    it("collapses concurrent recovery triggers into a single run", async () => {
      let orgCalls = 0;
      let hangRecovery = false;
      let releaseOrg!: () => void;
      const orgGate = new Promise<void>((resolve) => {
        releaseOrg = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | Request) => {
          const url = typeof input === "string" ? input : input.url;
          if (url.includes("/api/users/@me/")) {
            return {
              ok: true,
              json: vi.fn().mockResolvedValue({
                uuid: "user-1",
                organization: { id: "org-1" },
              }),
            } as unknown as Response;
          }
          if (/\/api\/organizations\/[^/]+\/$/.test(url)) {
            orgCalls++;
            if (!hangRecovery) {
              throw new TypeError("fetch failed");
            }
            await orgGate;
            return {
              ok: true,
              json: vi.fn().mockResolvedValue({
                name: "Org 1",
                teams: [{ id: 42, name: "Project 42" }],
              }),
            } as unknown as Response;
          }
          return {
            ok: true,
            json: vi.fn().mockResolvedValue({ has_access: true }),
          } as unknown as Response;
        }) as unknown as typeof fetch,
      );
      oauthFlow.startFlow.mockResolvedValue(mockTokenResponse());
      vi.mocked(connectivity.getStatus).mockReturnValue({ isOnline: false });

      await service.login("us");
      expect(service.getState().currentProjectId).toBeNull();
      await flushPostSyncKick();

      orgCalls = 0;
      hangRecovery = true;
      vi.mocked(connectivity.getStatus).mockReturnValue({ isOnline: true });
      emitStatus(true);
      emitStatus(true);
      getResumeHandler()();

      await vi.waitFor(() => {
        expect(orgCalls).toBe(1);
      });
      await flushPostSyncKick();
      expect(orgCalls).toBe(1);

      releaseOrg();
      await vi.waitFor(() => {
        expect(service.getState().currentProjectId).toBe(42);
      });
    });

    it("preserves the stored project while project-less so recovery can restore it", async () => {
      seedStoredSession({
        selectedProjectId: 84,
        scopeVersion: OAUTH_SCOPE_VERSION - 1,
      });
      await service.initialize();

      const fetchState = { succeeds: false, orgCalls: 0 };
      stubOrgFetch(fetchState);
      oauthFlow.startFlow.mockResolvedValue(mockTokenResponse());
      vi.mocked(connectivity.getStatus).mockReturnValue({ isOnline: false });

      await service.login("us");

      expect(service.getState().currentProjectId).toBeNull();
      expect(sessionPort.getCurrent()?.selectedProjectId).toBe(84);
    });

    it("does not attempt recovery when the token grants no scoped organizations", async () => {
      const fetchState = { succeeds: true, orgCalls: 0 };
      stubOrgFetch(fetchState);
      oauthFlow.startFlow.mockResolvedValue(
        mockTokenResponse({ scopedOrgs: [] }),
      );

      await service.login("us");

      expect(service.getState()).toMatchObject({
        status: "authenticated",
        currentProjectId: null,
        orgProjectsMap: {},
      });

      emitStatus(true);
      await new Promise((r) => setTimeout(r, 10));

      expect(fetchState.orgCalls).toBe(0);
      expect(service.getState().currentProjectId).toBeNull();
    });
  });

  describe("switchOrg", () => {
    const twoOrgs = {
      "org-1": {
        name: "Org 1",
        projects: [{ id: 11, name: "Project 11" }],
      },
      "org-2": {
        name: "Org 2",
        projects: [
          { id: 22, name: "Project 22" },
          { id: 33, name: "Project 33" },
        ],
      },
    };

    function arrangeTwoOrgs() {
      oauthFlow.startFlow.mockResolvedValue(
        mockTokenResponse({ scopedOrgs: ["org-1", "org-2"] }),
      );
      oauthFlow.refreshToken.mockResolvedValue(
        mockTokenResponse({ scopedOrgs: ["org-1", "org-2"] }),
      );
      stubAuthFetch({ orgs: twoOrgs });
    }

    it("switches the active organization and refreshes its projects", async () => {
      arrangeTwoOrgs();

      await service.login("us");
      expect(service.getState().currentOrgId).toBe("org-1");

      const state = await service.switchOrg("org-2");

      expect(state.currentOrgId).toBe("org-2");
      expect(state.currentProjectId).toBe(22);
      expect(state.orgProjectsMap["org-2"].projects).toEqual([
        { id: 22, name: "Project 22" },
        { id: 33, name: "Project 33" },
      ]);
    });

    it("throws when the target organization is not in the scoped map", async () => {
      arrangeTwoOrgs();
      await service.login("us");

      await expect(service.switchOrg("org-unknown")).rejects.toThrow(
        /Invalid organization/i,
      );
    });

    it("restores the last selected project for the org when available", async () => {
      arrangeTwoOrgs();

      await service.login("us");
      await service.switchOrg("org-2");
      await service.selectProject(33);
      await service.switchOrg("org-1");

      const state = await service.switchOrg("org-2");
      expect(state.currentProjectId).toBe(33);
    });

    it("persists the new selected project so it survives restart", async () => {
      arrangeTwoOrgs();

      await service.login("us");
      await service.switchOrg("org-2");

      expect(sessionPort.getCurrent()?.selectedProjectId).toBe(22);
    });
  });

  describe("selectProject cross-org", () => {
    it("PATCHes the user org and updates state when the chosen project lives in a different org", async () => {
      const orgs = {
        "org-1": {
          name: "Org 1",
          projects: [{ id: 1, name: "P1" }],
        },
        "org-2": {
          name: "Org 2",
          projects: [{ id: 2, name: "P2" }],
        },
      };
      oauthFlow.startFlow.mockResolvedValue(
        mockTokenResponse({ scopedOrgs: ["org-1", "org-2"] }),
      );
      oauthFlow.refreshToken.mockResolvedValue(
        mockTokenResponse({ scopedOrgs: ["org-1", "org-2"] }),
      );
      stubAuthFetch({ orgs });

      const fetchSpy = vi.spyOn(globalThis, "fetch");

      await service.login("us");
      const state = await service.selectProject(2);

      expect(state.currentOrgId).toBe("org-2");
      expect(state.currentProjectId).toBe(2);

      const patchCalls = fetchSpy.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patchCalls.length).toBeGreaterThan(0);
      const [patchUrl, patchInit] = patchCalls[0];
      expect(String(patchUrl)).toMatch(/\/api\/users\/@me\//);
      expect(String((patchInit as RequestInit).body)).toContain(
        '"set_current_organization":"org-2"',
      );
    });
  });

  describe("redeemInviteCode uses authenticatedFetch", () => {
    it("retries on 401 via authenticatedFetch", async () => {
      oauthFlow.startFlow.mockResolvedValue(
        mockTokenResponse({
          accessToken: "initial-token",
          refreshToken: "refresh-token",
        }),
      );
      oauthFlow.refreshToken.mockResolvedValue(
        mockTokenResponse({
          accessToken: "refreshed-token",
          refreshToken: "new-refresh-token",
        }),
      );

      let redeemCallCount = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | Request) => {
          const url = typeof input === "string" ? input : input.url;

          if (url.includes("/api/users/@me/")) {
            return {
              ok: true,
              json: vi.fn().mockResolvedValue({ uuid: "user-1" }),
            } as unknown as Response;
          }

          if (url.includes("/invites/redeem/")) {
            redeemCallCount++;
            if (redeemCallCount === 1) {
              return {
                ok: false,
                status: 401,
                json: () => Promise.resolve({}),
              } as unknown as Response;
            }
            return {
              ok: true,
              status: 200,
              json: () => Promise.resolve({ success: true }),
            } as unknown as Response;
          }

          return {
            ok: true,
            json: vi.fn().mockResolvedValue({ has_access: true }),
          } as unknown as Response;
        }) as unknown as typeof fetch,
      );

      await service.login("us");
      const state = await service.redeemInviteCode("test-code");

      expect(state.hasCodeAccess).toBe(true);
      expect(redeemCallCount).toBe(2);
    });
  });
});
