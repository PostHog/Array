import { EventEmitter } from "node:events";
import type { IPowerManager } from "@posthog/platform/power-manager";
import { OAUTH_SCOPE_VERSION } from "@shared/constants/oauth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockAuthPreferenceRepository } from "../../db/repositories/auth-preference-repository.mock";
import { createMockAuthSessionRepository } from "../../db/repositories/auth-session-repository.mock";
import { decrypt, encrypt } from "../../utils/encryption";
import { ConnectivityEvent } from "../connectivity/schemas";
import type { ConnectivityService } from "../connectivity/service";
import type { OAuthService } from "../oauth/service";
import { AuthService } from "./service";

const mockPowerManager = vi.hoisted(() => ({
  onResume: vi.fn(() => () => {}),
  preventSleep: vi.fn(() => () => {}),
}));

vi.mock("@shared/utils/backoff", () => ({
  sleepWithBackoff: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

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
  const preferenceRepository = createMockAuthPreferenceRepository();
  const repository = createMockAuthSessionRepository();

  const oauthService = {
    refreshToken: vi.fn(),
    startFlow: vi.fn(),
    startSignupFlow: vi.fn(),
  } as unknown as OAuthService;

  const connectivityEmitter = new EventEmitter();
  const connectivityService = Object.assign(connectivityEmitter, {
    getStatus: vi.fn(() => ({ isOnline: true })),
    checkNow: vi.fn(),
  }) as unknown as ConnectivityService;

  let service: AuthService;

  function seedStoredSession(
    overrides: {
      refreshToken?: string;
      selectedProjectId?: number | null;
      scopeVersion?: number;
    } = {},
  ) {
    repository.saveCurrent({
      refreshTokenEncrypted: encrypt(
        overrides.refreshToken ?? "stored-refresh-token",
      ),
      cloudRegion: "us",
      selectedProjectId: overrides.selectedProjectId ?? null,
      scopeVersion: overrides.scopeVersion ?? OAUTH_SCOPE_VERSION,
    });
  }

  function emitOnline() {
    connectivityEmitter.emit(ConnectivityEvent.StatusChange, {
      isOnline: true,
    });
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
      }) as typeof fetch,
    );
  };

  beforeEach(() => {
    preferenceRepository._preferences = [];
    preferenceRepository._orgProjectPreferences = [];
    repository.clearCurrent();
    vi.clearAllMocks();
    connectivityEmitter.removeAllListeners();
    service = new AuthService(
      preferenceRepository,
      repository,
      oauthService,
      connectivityService,
      mockPowerManager as unknown as IPowerManager,
    );
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
    vi.mocked(oauthService.refreshToken).mockResolvedValue(
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

    expect(decrypt(repository.getCurrent()?.refreshTokenEncrypted ?? "")).toBe(
      "rotated-refresh-token",
    );
  });

  it("forces a token refresh when explicitly requested", async () => {
    vi.mocked(oauthService.startFlow).mockResolvedValue(
      mockTokenResponse({
        accessToken: "initial-access-token",
        refreshToken: "initial-refresh-token",
      }),
    );
    vi.mocked(oauthService.refreshToken).mockResolvedValue(
      mockTokenResponse({
        accessToken: "refreshed-access-token",
        refreshToken: "rotated-refresh-token",
      }),
    );
    stubAuthFetch();

    await service.login("us");
    const token = await service.refreshAccessToken();

    expect(token.accessToken).toBe("refreshed-access-token");
    expect(oauthService.refreshToken).toHaveBeenCalledWith(
      "initial-refresh-token",
      "us",
    );
    expect(decrypt(repository.getCurrent()?.refreshTokenEncrypted ?? "")).toBe(
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
    vi.mocked(oauthService.startFlow)
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
    vi.mocked(oauthService.refreshToken).mockResolvedValue(
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
    vi.mocked(oauthService.startFlow)
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
    vi.mocked(oauthService.refreshToken).mockResolvedValue(
      mockTokenResponse({
        accessToken: "refreshed-access-token",
        refreshToken: "refreshed-refresh-token",
      }),
    );
    stubAuthFetch({ orgs });

    await service.login("us");
    await service.selectProject(84);
    await service.logout();

    service = new AuthService(
      preferenceRepository,
      repository,
      oauthService,
      connectivityService,
      mockPowerManager as unknown as IPowerManager,
    );

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
      vi.mocked(connectivityService.getStatus).mockReturnValue({
        isOnline: false,
      });
      await service.initialize();
      expect(service.getState().status).toBe("anonymous");

      vi.mocked(connectivityService.getStatus).mockReturnValue({
        isOnline: true,
      });
      vi.mocked(oauthService.refreshToken).mockResolvedValue(
        mockTokenResponse(),
      );
      stubAuthFetch();

      emitOnline();

      await vi.waitFor(() => {
        expect(service.getState().status).toBe("authenticated");
      });
    });

    it("does nothing when session already exists", async () => {
      vi.mocked(oauthService.startFlow).mockResolvedValue(mockTokenResponse());
      stubAuthFetch();
      await service.login("us");
      vi.mocked(oauthService.refreshToken).mockClear();

      emitOnline();

      await new Promise((r) => setTimeout(r, 10));
      expect(oauthService.refreshToken).not.toHaveBeenCalled();
    });

    it("ignores offline events", async () => {
      seedStoredSession();

      connectivityEmitter.emit(ConnectivityEvent.StatusChange, {
        isOnline: false,
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(oauthService.refreshToken).not.toHaveBeenCalled();
    });

    it("deduplicates concurrent recovery attempts", async () => {
      seedStoredSession();

      let resolveRefresh!: () => void;
      vi.mocked(oauthService.refreshToken).mockReturnValue(
        new Promise((resolve) => {
          resolveRefresh = () => resolve(mockTokenResponse());
        }),
      );
      stubAuthFetch();

      emitOnline();
      emitOnline();

      await new Promise((r) => setTimeout(r, 10));
      expect(oauthService.refreshToken).toHaveBeenCalledTimes(1);

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
      const unsubscribeSpy = vi.fn();
      mockPowerManager.onResume.mockReturnValueOnce(unsubscribeSpy);

      service.shutdown();
      expect(unsubscribe).toBeDefined();
    });

    it("attempts session recovery on resume", async () => {
      seedStoredSession();
      vi.mocked(oauthService.refreshToken).mockResolvedValue(
        mockTokenResponse(),
      );
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
        vi.mocked(oauthService.refreshToken)
          .mockResolvedValueOnce({
            success: false,
            error: "Transient failure",
            errorCode,
          })
          .mockResolvedValueOnce(mockTokenResponse());
        stubAuthFetch();

        await service.initialize();

        expect(service.getState().status).toBe("authenticated");
        expect(oauthService.refreshToken).toHaveBeenCalledTimes(2);
      },
    );

    it("does not retry on auth_error and forces logout", async () => {
      seedStoredSession({ selectedProjectId: 42 });
      vi.mocked(oauthService.refreshToken).mockResolvedValue({
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
      expect(oauthService.refreshToken).toHaveBeenCalledTimes(1);
      expect(repository.getCurrent()).toBeNull();
    });

    it("does not retry on unknown_error", async () => {
      seedStoredSession();
      vi.mocked(oauthService.refreshToken).mockResolvedValue({
        success: false,
        error: "Something weird",
        errorCode: "unknown_error",
      });

      await service.initialize();

      expect(service.getState().status).toBe("anonymous");
      expect(oauthService.refreshToken).toHaveBeenCalledTimes(1);
    });

    it("gives up after all retry attempts are exhausted", async () => {
      seedStoredSession();
      vi.mocked(oauthService.refreshToken).mockResolvedValue({
        success: false,
        error: "Network error",
        errorCode: "network_error",
      });

      await service.initialize();

      expect(service.getState().status).toBe("anonymous");
      expect(oauthService.refreshToken).toHaveBeenCalledTimes(3);
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
      vi.mocked(oauthService.startFlow).mockResolvedValue(
        mockTokenResponse({ scopedOrgs: ["org-1", "org-2"] }),
      );
      vi.mocked(oauthService.refreshToken).mockResolvedValue(
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

      expect(repository.getCurrent()?.selectedProjectId).toBe(22);
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
      vi.mocked(oauthService.startFlow).mockResolvedValue(
        mockTokenResponse({ scopedOrgs: ["org-1", "org-2"] }),
      );
      vi.mocked(oauthService.refreshToken).mockResolvedValue(
        mockTokenResponse({ scopedOrgs: ["org-1", "org-2"] }),
      );
      stubAuthFetch({ orgs });

      const fetchSpy = vi.spyOn(global, "fetch");

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
      vi.mocked(oauthService.startFlow).mockResolvedValue(
        mockTokenResponse({
          accessToken: "initial-token",
          refreshToken: "refresh-token",
        }),
      );
      vi.mocked(oauthService.refreshToken).mockResolvedValue(
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
        }) as typeof fetch,
      );

      await service.login("us");
      const state = await service.redeemInviteCode("test-code");

      expect(state.hasCodeAccess).toBe(true);
      expect(redeemCallCount).toBe(2);
    });
  });
});
