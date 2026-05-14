import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPerformOAuthFlow,
  mockRefreshAccessTokenRequest,
  mockGetTokens,
  mockSaveTokens,
  mockDeleteTokens,
  mockRegisterAndUpload,
  mockClearPushToken,
  mockQueryClientClear,
} = vi.hoisted(() => ({
  mockPerformOAuthFlow: vi.fn(),
  mockRefreshAccessTokenRequest: vi.fn(),
  mockGetTokens: vi.fn(),
  mockSaveTokens: vi.fn(),
  mockDeleteTokens: vi.fn(),
  mockRegisterAndUpload: vi.fn(),
  mockClearPushToken: vi.fn(),
  mockQueryClientClear: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock("../lib/oauth", () => ({
  performOAuthFlow: mockPerformOAuthFlow,
  refreshAccessToken: mockRefreshAccessTokenRequest,
}));

vi.mock("../lib/secureStorage", () => ({
  getTokens: mockGetTokens,
  saveTokens: mockSaveTokens,
  deleteTokens: mockDeleteTokens,
}));

vi.mock("@/features/notifications/stores/pushTokenStore", () => ({
  usePushTokenStore: {
    getState: () => ({
      registerAndUpload: mockRegisterAndUpload,
      clear: mockClearPushToken,
    }),
  },
}));

vi.mock("@/features/preferences/stores/preferencesStore", () => ({
  usePreferencesStore: {
    getState: () => ({
      pushNotificationsEnabled: false,
    }),
  },
}));

vi.mock("@/lib/queryClient", () => ({
  queryClient: {
    clear: mockQueryClientClear,
  },
}));

import { OAUTH_SCOPE_VERSION } from "../lib/constants";
import { useAuthStore } from "./authStore";

describe("authStore", () => {
  beforeEach(() => {
    mockPerformOAuthFlow.mockReset();
    mockRefreshAccessTokenRequest.mockReset();
    mockGetTokens.mockReset();
    mockSaveTokens.mockReset();
    mockDeleteTokens.mockReset();
    mockRegisterAndUpload.mockReset();
    mockClearPushToken.mockReset();
    mockQueryClientClear.mockReset();

    useAuthStore.setState({
      oauthAccessToken: null,
      oauthRefreshToken: null,
      tokenExpiry: null,
      cloudRegion: null,
      projectId: null,
      isAuthenticated: false,
      isLoading: true,
    });
  });

  it("stores the current OAuth scope version on login", async () => {
    mockPerformOAuthFlow.mockResolvedValueOnce({
      success: true,
      data: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "user:read",
        scoped_teams: [42],
      },
    });

    await useAuthStore.getState().loginWithOAuth("us");

    expect(mockSaveTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        scopedTeams: [42],
        scopeVersion: OAUTH_SCOPE_VERSION,
      }),
    );
  });

  it("forces reauthentication when persisted tokens use an older scope version", async () => {
    mockGetTokens.mockResolvedValueOnce({
      accessToken: "old-token",
      refreshToken: "old-refresh",
      expiresAt: Date.now() + 60_000,
      cloudRegion: "us",
      scopedTeams: [42],
      scopeVersion: OAUTH_SCOPE_VERSION - 1,
    });

    const initialized = await useAuthStore.getState().initializeAuth();

    expect(initialized).toBe(false);
    expect(mockDeleteTokens).toHaveBeenCalledOnce();
    expect(mockQueryClientClear).toHaveBeenCalledOnce();
    expect(useAuthStore.getState()).toMatchObject({
      oauthAccessToken: null,
      oauthRefreshToken: null,
      projectId: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });
});
