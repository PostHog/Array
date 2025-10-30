import { PostHogAPIClient } from "@api/posthogClient";
import { queryClient } from "@renderer/lib/queryClient";
import type { CloudRegion } from "@shared/types/oauth";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  getCloudUrlFromRegion,
  TOKEN_REFRESH_BUFFER_MS,
} from "@/constants/oauth";

const RECALL_API_URL = "https://us-west-2.recall.ai";

interface AuthState {
  // OAuth state
  oauthAccessToken: string | null;
  oauthRefreshToken: string | null;
  tokenExpiry: number | null; // Unix timestamp in milliseconds
  cloudRegion: CloudRegion | null;
  encryptedOAuthTokens: string | null;

  // PostHog client
  isAuthenticated: boolean;
  client: PostHogAPIClient | null;
  projectId: number | null; // Current team/project ID

  // OpenAI API key (separate concern, kept for now)
  openaiApiKey: string | null;
  encryptedOpenaiKey: string | null;

  // OAuth methods
  loginWithOAuth: (region: CloudRegion) => Promise<void>;
  refreshAccessToken: () => Promise<void>;
  scheduleTokenRefresh: () => void;
  initializeOAuth: () => Promise<boolean>;

  // Other methods
  setOpenAIKey: (apiKey: string) => Promise<void>;
  logout: () => void;
}

let refreshTimeoutId: number | null = null;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // OAuth state
      oauthAccessToken: null,
      oauthRefreshToken: null,
      tokenExpiry: null,
      cloudRegion: null,
      encryptedOAuthTokens: null,

      // PostHog client
      isAuthenticated: false,
      client: null,
      projectId: null,

      // OpenAI key
      openaiApiKey: null,
      encryptedOpenaiKey: null,

      loginWithOAuth: async (region: CloudRegion) => {
        const result = await window.electronAPI.oauthStartFlow(region);

        if (!result.success || !result.data) {
          throw new Error(result.error || "OAuth flow failed");
        }

        const tokenResponse = result.data;
        const expiresAt = Date.now() + tokenResponse.expires_in * 1000;

        const projectId = tokenResponse.scoped_teams?.[0];

        if (!projectId) {
          throw new Error("No team found in OAuth scopes");
        }

        const storeResult = await window.electronAPI.oauthEncryptTokens({
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          expiresAt,
          cloudRegion: region,
        });

        if (!storeResult.success || !storeResult.encrypted) {
          throw new Error(storeResult.error || "Failed to store tokens");
        }

        const apiHost = getCloudUrlFromRegion(region);

        const client = new PostHogAPIClient(
          tokenResponse.access_token,
          apiHost,
          async () => {
            await get().refreshAccessToken();
            const token = get().oauthAccessToken;
            if (!token) {
              throw new Error("No access token after refresh");
            }
            return token;
          },
          projectId,
        );

        try {
          await client.getCurrentUser();

          set({
            oauthAccessToken: tokenResponse.access_token,
            oauthRefreshToken: tokenResponse.refresh_token,
            tokenExpiry: expiresAt,
            cloudRegion: region,
            encryptedOAuthTokens: storeResult.encrypted,
            isAuthenticated: true,
            client,
            projectId,
          });

          get().scheduleTokenRefresh();
        } catch {
          throw new Error("Failed to authenticate with PostHog");
        }

        try {
          window.electronAPI
            .recallInitialize(
              RECALL_API_URL,
              tokenResponse.access_token,
              apiHost,
            )
            .catch((error) => {
              console.error("[Auth] Failed to initialize Recall SDK:", error);
            });
        } catch (_error) {
          throw new Error("Invalid API key or host");
        }
      },

      refreshAccessToken: async () => {
        const state = get();

        if (!state.oauthRefreshToken || !state.cloudRegion) {
          throw new Error("No refresh token available");
        }

        const result = await window.electronAPI.oauthRefreshToken(
          state.oauthRefreshToken,
          state.cloudRegion,
        );

        if (!result.success || !result.data) {
          // Refresh failed - logout user
          get().logout();
          throw new Error(result.error || "Token refresh failed");
        }

        const tokenResponse = result.data;
        const expiresAt = Date.now() + tokenResponse.expires_in * 1000;

        const storeResult = await window.electronAPI.oauthEncryptTokens({
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          expiresAt,
          cloudRegion: state.cloudRegion,
        });

        if (!storeResult.success || !storeResult.encrypted) {
          throw new Error(
            storeResult.error || "Failed to store refreshed tokens",
          );
        }

        const apiHost = getCloudUrlFromRegion(state.cloudRegion);
        const client = new PostHogAPIClient(
          tokenResponse.access_token,
          apiHost,
          async () => {
            await get().refreshAccessToken();
            const token = get().oauthAccessToken;
            if (!token) {
              throw new Error("No access token after refresh");
            }
            return token;
          },
          state.projectId || undefined,
        );

        set({
          oauthAccessToken: tokenResponse.access_token,
          oauthRefreshToken: tokenResponse.refresh_token,
          tokenExpiry: expiresAt,
          encryptedOAuthTokens: storeResult.encrypted,
          client,
        });

        get().scheduleTokenRefresh();
      },

      scheduleTokenRefresh: () => {
        const state = get();

        if (refreshTimeoutId) {
          clearTimeout(refreshTimeoutId);
          refreshTimeoutId = null;
        }

        if (!state.tokenExpiry) {
          return;
        }

        const timeUntilRefresh =
          state.tokenExpiry - Date.now() - TOKEN_REFRESH_BUFFER_MS;

        if (timeUntilRefresh > 0) {
          refreshTimeoutId = setTimeout(() => {
            get()
              .refreshAccessToken()
              .catch((error) => {
                console.error("Proactive token refresh failed:", error);
              });
          }, timeUntilRefresh);
        } else {
          get()
            .refreshAccessToken()
            .catch((error) => {
              console.error("Immediate token refresh failed:", error);
            });
        }
      },

      initializeOAuth: async () => {
        const state = get();

        if (state.encryptedOAuthTokens) {
          const result = await window.electronAPI.oauthRetrieveTokens(
            state.encryptedOAuthTokens,
          );

          if (result.success && result.data) {
            const tokens = result.data;
            const now = Date.now();
            const isExpired = tokens.expiresAt <= now;

            set({
              oauthAccessToken: tokens.accessToken,
              oauthRefreshToken: tokens.refreshToken,
              tokenExpiry: tokens.expiresAt,
              cloudRegion: tokens.cloudRegion,
            });

            if (isExpired) {
              try {
                await get().refreshAccessToken();
              } catch (error) {
                console.error("Failed to refresh expired token:", error);
                set({ encryptedOAuthTokens: null, isAuthenticated: false });
                return false;
              }
            }

            const apiHost = getCloudUrlFromRegion(tokens.cloudRegion);
            const projectId = state.projectId;

            if (!projectId) {
              console.error("No project ID found in stored auth state");
              set({ encryptedOAuthTokens: null, isAuthenticated: false });
              return false;
            }

            const client = new PostHogAPIClient(
              tokens.accessToken,
              apiHost,
              async () => {
                await get().refreshAccessToken();
                const token = get().oauthAccessToken;
                if (!token) {
                  throw new Error("No access token after refresh");
                }
                return token;
              },
              projectId,
            );

            try {
              await client.getCurrentUser();

              set({
                isAuthenticated: true,
                client,
              });

              get().scheduleTokenRefresh();

              if (state.encryptedOpenaiKey) {
                const decryptedOpenaiKey =
                  await window.electronAPI.retrieveApiKey(
                    state.encryptedOpenaiKey,
                  );

                if (decryptedOpenaiKey) {
                  set({ openaiApiKey: decryptedOpenaiKey });
                }
              }

              return true;
            } catch (error) {
              console.error("Failed to validate OAuth session:", error);
              set({ encryptedOAuthTokens: null, isAuthenticated: false });
              return false;
            }
          }
        }

        if (state.encryptedOpenaiKey) {
          const decryptedOpenaiKey = await window.electronAPI.retrieveApiKey(
            state.encryptedOpenaiKey,
          );

          if (decryptedOpenaiKey) {
            set({ openaiApiKey: decryptedOpenaiKey });
          }
        }

        return state.isAuthenticated;
      },

      setOpenAIKey: async (apiKey: string) => {
        const encryptedKey = await window.electronAPI.storeApiKey(apiKey);
        set({
          openaiApiKey: apiKey,
          encryptedOpenaiKey: encryptedKey,
        });
      },
      logout: () => {
        if (refreshTimeoutId) {
          clearTimeout(refreshTimeoutId);
          refreshTimeoutId = null;
        }

        window.electronAPI.oauthDeleteTokens();

        queryClient.clear();

        set({
          oauthAccessToken: null,
          oauthRefreshToken: null,
          tokenExpiry: null,
          cloudRegion: null,
          encryptedOAuthTokens: null,
          isAuthenticated: false,
          client: null,
          projectId: null,
          openaiApiKey: null,
          encryptedOpenaiKey: null,
        });
      },
    }),
    {
      name: "mission-control-auth",
      partialize: (state) => ({
        cloudRegion: state.cloudRegion,
        encryptedOAuthTokens: state.encryptedOAuthTokens,
        encryptedOpenaiKey: state.encryptedOpenaiKey,
        projectId: state.projectId,
      }),
    },
  ),
);
