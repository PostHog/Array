import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetState = vi.hoisted(() => ({ query: vi.fn() }));
const mockGetValidAccessToken = vi.hoisted(() => ({ query: vi.fn() }));
const mockRefreshAccessToken = vi.hoisted(() => ({ mutate: vi.fn() }));
const mockLogin = vi.hoisted(() => ({ mutate: vi.fn() }));
const mockSignup = vi.hoisted(() => ({ mutate: vi.fn() }));
const mockSelectProject = vi.hoisted(() => ({ mutate: vi.fn() }));
const mockRedeemInviteCode = vi.hoisted(() => ({ mutate: vi.fn() }));
const mockLogout = vi.hoisted(() => ({ mutate: vi.fn() }));
const mockGetCurrentUser = vi.fn();

vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {
    auth: {
      getState: mockGetState,
      getValidAccessToken: mockGetValidAccessToken,
      refreshAccessToken: mockRefreshAccessToken,
      login: mockLogin,
      signup: mockSignup,
      selectProject: mockSelectProject,
      redeemInviteCode: mockRedeemInviteCode,
      logout: mockLogout,
    },
    analytics: {
      setUserId: { mutate: vi.fn().mockResolvedValue(undefined) },
      resetUser: { mutate: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

vi.mock("@renderer/api/posthogClient", () => ({
  PostHogAPIClient: vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
  ) {
    this.getCurrentUser = mockGetCurrentUser;
    this.setTeamId = vi.fn();
  }),
  SeatSubscriptionRequiredError: class SeatSubscriptionRequiredError extends Error {
    redirectUrl: string;
    constructor(redirectUrl: string) {
      super("Billing subscription required");
      this.name = "SeatSubscriptionRequiredError";
      this.redirectUrl = redirectUrl;
    }
  },
  SeatPaymentFailedError: class SeatPaymentFailedError extends Error {
    constructor(message?: string) {
      super(message ?? "Payment failed");
      this.name = "SeatPaymentFailedError";
    }
  },
}));

vi.mock("@utils/analytics", () => ({
  identifyUser: vi.fn(),
  resetUser: vi.fn(),
  setUserGroups: vi.fn(),
  track: vi.fn(),
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

vi.mock("@utils/queryClient", () => ({
  queryClient: {
    clear: vi.fn(),
    setQueryData: vi.fn(),
    removeQueries: vi.fn(),
  },
}));

vi.mock("@stores/navigationStore", () => ({
  useNavigationStore: {
    getState: () => ({ navigateToTaskInput: vi.fn() }),
  },
}));

import { resetUser, setUserGroups } from "@utils/analytics";
import { queryClient } from "@utils/queryClient";
import { resetAuthStoreModuleStateForTest, useAuthStore } from "./authStore";

const authenticatedState = {
  status: "authenticated" as const,
  bootstrapComplete: true,
  cloudRegion: "us" as const,
  projectId: 1,
  availableProjectIds: [1, 2],
  availableOrgIds: ["org-1"],
  hasCodeAccess: true,
  needsScopeReauth: false,
};

describe("authStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthStoreModuleStateForTest();
    mockGetCurrentUser.mockResolvedValue({
      distinct_id: "user-123",
      email: "test@example.com",
      uuid: "uuid-123",
    });
    mockGetValidAccessToken.query.mockResolvedValue({
      accessToken: "test-access-token",
      apiHost: "https://us.posthog.com",
    });
    mockRefreshAccessToken.mutate.mockResolvedValue({
      accessToken: "fresh-access-token",
      apiHost: "https://us.posthog.com",
    });
    mockGetState.query.mockResolvedValue({
      status: "anonymous",
      bootstrapComplete: true,
      cloudRegion: null,
      projectId: null,
      availableProjectIds: [],
      availableOrgIds: [],
      hasCodeAccess: null,
      needsScopeReauth: false,
    });
    useAuthStore.setState({
      cloudRegion: null,
      staleCloudRegion: null,
      isAuthenticated: false,
      client: null,
      projectId: null,
      availableProjectIds: [],
      availableOrgIds: [],
      needsProjectSelection: false,
      needsScopeReauth: false,
      hasCodeAccess: null,
    });
  });

  it("syncs from main auth state", async () => {
    mockGetState.query.mockResolvedValue(authenticatedState);

    await useAuthStore.getState().checkCodeAccess();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().projectId).toBe(1);
  });

  it("logs in through the main auth service", async () => {
    mockLogin.mutate.mockResolvedValue({ state: authenticatedState });
    mockGetState.query.mockResolvedValue(authenticatedState);

    await useAuthStore.getState().loginWithOAuth("us");

    expect(mockLogin.mutate).toHaveBeenCalledWith({ region: "us" });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().needsScopeReauth).toBe(false);
  });

  it("deduplicates expensive renderer auth sync for repeated auth-state events", async () => {
    mockGetState.query.mockResolvedValue(authenticatedState);

    await useAuthStore.getState().checkCodeAccess();
    await useAuthStore.getState().checkCodeAccess();

    expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
    expect(setUserGroups).toHaveBeenCalledTimes(1);
  });

  it("clears user identity and cached current user on implicit auth loss", async () => {
    mockGetState.query
      .mockResolvedValueOnce(authenticatedState)
      .mockResolvedValueOnce({
        status: "anonymous",
        bootstrapComplete: true,
        cloudRegion: null,
        projectId: null,
        availableProjectIds: [],
        availableOrgIds: [],
        hasCodeAccess: null,
        needsScopeReauth: false,
      });

    await useAuthStore.getState().checkCodeAccess();
    await useAuthStore.getState().checkCodeAccess();

    expect(resetUser).toHaveBeenCalledTimes(1);
    expect(queryClient.removeQueries).toHaveBeenCalledWith({
      queryKey: ["currentUser"],
      exact: true,
    });
  });

  it("clears auth state immediately on logout before the auth service responds", async () => {
    mockGetState.query.mockResolvedValue(authenticatedState);
    let resolveLogout!: () => void;
    mockLogout.mutate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLogout = () => resolve(undefined);
        }),
    );

    await useAuthStore.getState().checkCodeAccess();

    const logoutPromise = useAuthStore.getState().logout();
    await Promise.resolve();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().client).toBeNull();
    expect(useAuthStore.getState().projectId).toBeNull();
    expect(useAuthStore.getState().needsScopeReauth).toBe(false);

    resolveLogout();
    await logoutPromise;
  });
});
