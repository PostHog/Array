import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { usePushTokenStore } from "@/features/notifications/stores/pushTokenStore";
import { usePreferencesStore } from "@/features/preferences/stores/preferencesStore";
import { logger } from "@/lib/logger";
import { queryClient } from "@/lib/queryClient";
import {
  getCloudUrlFromRegion,
  OAUTH_SCOPES,
  TOKEN_REFRESH_BUFFER_MS,
} from "../lib/constants";
import {
  performOAuthFlow,
  refreshAccessToken as refreshAccessTokenRequest,
} from "../lib/oauth";
import { deleteTokens, getTokens, saveTokens } from "../lib/secureStorage";
import type { CloudRegion, StoredTokens } from "../types";

interface AuthState {
  // OAuth state
  oauthAccessToken: string | null;
  oauthRefreshToken: string | null;
  tokenExpiry: number | null;
  cloudRegion: CloudRegion | null;
  projectId: number | null;

  // Auth status
  isAuthenticated: boolean;
  isLoading: boolean;

  // Methods
  loginWithOAuth: (region: CloudRegion) => Promise<void>;
  loginWithPersonalApiKey: (params: {
    token: string;
    projectId: number;
    region: CloudRegion;
  }) => Promise<void>;
  refreshAccessToken: () => Promise<void>;
  scheduleTokenRefresh: () => void;
  initializeAuth: () => Promise<boolean>;
  logout: () => Promise<void>;
  getCloudUrlFromRegion: (region: CloudRegion) => string;
}

let refreshTimeoutId: ReturnType<typeof setTimeout> | null = null;

function maybeRegisterPushToken(): void {
  if (!usePreferencesStore.getState().pushNotificationsEnabled) return;
  usePushTokenStore
    .getState()
    .registerAndUpload()
    .catch((error) => {
      logger.warn("Push token registration failed", error);
    });
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // OAuth state
      oauthAccessToken: null,
      oauthRefreshToken: null,
      tokenExpiry: null,
      cloudRegion: null,
      projectId: null,

      // Auth status
      isAuthenticated: false,
      isLoading: true,

      // Helper method to get cloud URL
      getCloudUrlFromRegion,

      loginWithOAuth: async (region: CloudRegion) => {
        const result = await performOAuthFlow({
          scopes: OAUTH_SCOPES,
          cloudRegion: region,
        });

        if (!result.success || !result.data) {
          throw new Error(result.error || "OAuth flow failed");
        }

        const tokenResponse = result.data;
        const expiresAt = Date.now() + tokenResponse.expires_in * 1000;
        const projectId = tokenResponse.scoped_teams?.[0];

        if (!projectId) {
          throw new Error("No team found in OAuth scopes");
        }

        const storedTokens: StoredTokens = {
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          expiresAt,
          cloudRegion: region,
          scopedTeams: tokenResponse.scoped_teams,
        };

        // Save tokens securely
        await saveTokens(storedTokens);

        set({
          oauthAccessToken: tokenResponse.access_token,
          oauthRefreshToken: tokenResponse.refresh_token,
          tokenExpiry: expiresAt,
          cloudRegion: region,
          projectId,
          isAuthenticated: true,
        });

        get().scheduleTokenRefresh();
        maybeRegisterPushToken();
      },

      loginWithPersonalApiKey: async ({ token, projectId, region }) => {
        if (!__DEV__) {
          throw new Error(
            "Dev sign-in is only available in development builds",
          );
        }
        const trimmed = token.trim();
        if (!trimmed) {
          throw new Error("Personal API key is required");
        }
        if (!Number.isFinite(projectId) || projectId <= 0) {
          throw new Error("Valid project ID is required");
        }

        const storedTokens: StoredTokens = {
          accessToken: trimmed,
          refreshToken: "",
          expiresAt: Number.MAX_SAFE_INTEGER,
          cloudRegion: region,
          scopedTeams: [projectId],
        };

        await saveTokens(storedTokens);

        set({
          oauthAccessToken: trimmed,
          oauthRefreshToken: null,
          tokenExpiry: null,
          cloudRegion: region,
          projectId,
          isAuthenticated: true,
        });

        maybeRegisterPushToken();
      },

      refreshAccessToken: async () => {
        const state = get();

        if (!state.oauthRefreshToken || !state.cloudRegion) {
          throw new Error("No refresh token available");
        }

        const tokenResponse = await refreshAccessTokenRequest(
          state.oauthRefreshToken,
          state.cloudRegion,
        );

        const expiresAt = Date.now() + tokenResponse.expires_in * 1000;
        const projectId = tokenResponse.scoped_teams?.[0] || state.projectId;

        const storedTokens: StoredTokens = {
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          expiresAt,
          cloudRegion: state.cloudRegion,
          scopedTeams: tokenResponse.scoped_teams,
        };

        // Save tokens securely
        await saveTokens(storedTokens);

        set({
          oauthAccessToken: tokenResponse.access_token,
          oauthRefreshToken: tokenResponse.refresh_token,
          tokenExpiry: expiresAt,
          projectId,
        });

        get().scheduleTokenRefresh();
      },

      scheduleTokenRefresh: () => {
        const state = get();

        if (refreshTimeoutId) {
          clearTimeout(refreshTimeoutId);
          refreshTimeoutId = null;
        }

        // Personal API key sessions have no refresh token — nothing to schedule.
        if (!state.tokenExpiry || !state.oauthRefreshToken) {
          return;
        }

        const timeUntilRefresh =
          state.tokenExpiry - Date.now() - TOKEN_REFRESH_BUFFER_MS;

        if (timeUntilRefresh > 0) {
          refreshTimeoutId = setTimeout(() => {
            get()
              .refreshAccessToken()
              .catch((error) => {
                logger.error("Proactive token refresh failed:", error);
              });
          }, timeUntilRefresh);
        } else {
          get()
            .refreshAccessToken()
            .catch((error) => {
              logger.error("Immediate token refresh failed:", error);
            });
        }
      },

      initializeAuth: async () => {
        set({ isLoading: true });

        try {
          const tokens = await getTokens();

          if (!tokens) {
            set({ isLoading: false, isAuthenticated: false });
            return false;
          }

          const now = Date.now();
          const isExpired = tokens.expiresAt <= now;

          set({
            oauthAccessToken: tokens.accessToken,
            oauthRefreshToken: tokens.refreshToken,
            tokenExpiry: tokens.expiresAt,
            cloudRegion: tokens.cloudRegion,
            projectId: tokens.scopedTeams?.[0] || null,
          });

          if (isExpired) {
            try {
              await get().refreshAccessToken();
            } catch (error) {
              logger.error("Failed to refresh expired token:", error);
              await deleteTokens();
              set({ isLoading: false, isAuthenticated: false });
              return false;
            }
          }

          set({ isLoading: false, isAuthenticated: true });
          get().scheduleTokenRefresh();
          maybeRegisterPushToken();
          return true;
        } catch (error) {
          logger.error("Failed to initialize auth:", error);
          set({ isLoading: false, isAuthenticated: false });
          return false;
        }
      },

      logout: async () => {
        if (refreshTimeoutId) {
          clearTimeout(refreshTimeoutId);
          refreshTimeoutId = null;
        }

        // Delete push token from the backend before we drop credentials.
        await usePushTokenStore.getState().clear();

        await deleteTokens();

        // Clear React Query cache to prevent data leakage between sessions
        queryClient.clear();

        set({
          oauthAccessToken: null,
          oauthRefreshToken: null,
          tokenExpiry: null,
          cloudRegion: null,
          projectId: null,
          isAuthenticated: false,
        });
      },
    }),
    {
      name: "posthog-auth",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        cloudRegion: state.cloudRegion,
        projectId: state.projectId,
      }),
    },
  ),
);
