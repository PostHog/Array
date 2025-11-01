import { PostHogAPIClient } from "@api/posthogClient";
import {
  identifyUser,
  resetUser,
  trackUserLoggedIn,
  trackUserLoggedOut,
} from "@renderer/lib/analytics";
import { queryClient } from "@renderer/lib/queryClient";
import { useTabStore } from "@renderer/stores/tabStore";
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
  defaultWorkspace: string | null;

  // OAuth methods
  loginWithOAuth: (region: CloudRegion) => Promise<void>;
  refreshAccessToken: () => Promise<void>;
  scheduleTokenRefresh: () => void;
  initializeOAuth: () => Promise<boolean>;

  // Other methods
  setOpenAIKey: (apiKey: string) => Promise<void>;
  setDefaultWorkspace: (workspace: string) => void;
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
      defaultWorkspace: null,

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
          scopedTeams: tokenResponse.scoped_teams,
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

          // Clear any cached data from previous sessions AFTER setting new auth
          queryClient.clear();

          get().scheduleTokenRefresh();

          // Track user login
          identifyUser(`project-${projectId}`, {
            project_id: projectId.toString(),
            region,
          });
          trackUserLoggedIn({
            project_id: projectId.toString(),
            region,
          });

          // Navigate to task list after successful authentication
          const taskListTab = useTabStore
            .getState()
            .tabs.find((tab) => tab.type === "task-list");
          if (taskListTab) {
            useTabStore.getState().setActiveTab(taskListTab.id);
          }
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
          scopedTeams: tokenResponse.scoped_teams,
        });

        if (!storeResult.success || !storeResult.encrypted) {
          throw new Error(
            storeResult.error || "Failed to store refreshed tokens",
          );
        }

        const apiHost = getCloudUrlFromRegion(state.cloudRegion);
        const projectId =
          tokenResponse.scoped_teams?.[0] || state.projectId || undefined;

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

        set({
          oauthAccessToken: tokenResponse.access_token,
          oauthRefreshToken: tokenResponse.refresh_token,
          tokenExpiry: expiresAt,
          encryptedOAuthTokens: storeResult.encrypted,
          client,
          ...(projectId && { projectId }),
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
            const projectId = tokens.scopedTeams?.[0];

            if (!projectId) {
              console.error("No project ID found in stored tokens");
              get().logout();
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
                projectId,
              });

              get().scheduleTokenRefresh();

              // Track user identity on session restoration
              identifyUser(`project-${projectId}`, {
                project_id: projectId.toString(),
                region: tokens.cloudRegion,
              });

              // Navigate to task list after successful authentication
              const taskListTab = useTabStore
                .getState()
                .tabs.find((tab) => tab.type === "task-list");
              if (taskListTab) {
                useTabStore.getState().setActiveTab(taskListTab.id);
              }

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

      setDefaultWorkspace: (workspace: string) => {
        set({ defaultWorkspace: workspace });
      },
      logout: () => {
        // Track logout before clearing state
        trackUserLoggedOut();
        resetUser();

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
        defaultWorkspace: state.defaultWorkspace,
        projectId: state.projectId,
      }),
    },
  ),
);
