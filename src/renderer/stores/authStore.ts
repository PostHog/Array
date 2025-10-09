import { PostHogAPIClient } from "@api/posthogClient";
import type { DataSource, User } from "@shared/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  // Data sources
  enabledSources: DataSource[];
  setEnabledSources: (sources: DataSource[]) => void;

  // PostHog credentials
  apiKey: string | null;
  apiHost: string;
  encryptedKey: string | null;
  user: User | null;
  isAuthenticated: boolean;
  client: PostHogAPIClient | null;

  // OpenAI credentials
  openaiApiKey: string | null;
  encryptedOpenaiKey: string | null;
  setOpenaiKey: (apiKey: string) => Promise<void>;

  setCredentials: (apiKey: string, apiHost: string) => Promise<void>;
  checkAuth: () => Promise<boolean>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      enabledSources: [],
      apiKey: null,
      apiHost: "https://app.posthog.com",
      encryptedKey: null,
      user: null,
      isAuthenticated: false,
      client: null,
      openaiApiKey: null,
      encryptedOpenaiKey: null,

      setEnabledSources: (sources: DataSource[]) => {
        set({ enabledSources: sources });
      },

      setOpenaiKey: async (apiKey: string) => {
        // Encrypt the API key using Electron's secure storage
        const encryptedKey = await window.electronAPI.storeApiKey(apiKey);
        set({
          openaiApiKey: apiKey,
          encryptedOpenaiKey: encryptedKey,
        });
      },

      setCredentials: async (apiKey: string, apiHost: string) => {
        // Encrypt the API key using Electron's secure storage
        const encryptedKey = await window.electronAPI.storeApiKey(apiKey);

        // Create API client
        const client = new PostHogAPIClient(apiKey, apiHost);

        try {
          // Verify credentials by fetching user
          const user = await client.getCurrentUser();

          set({
            apiKey,
            apiHost,
            encryptedKey,
            user,
            isAuthenticated: true,
            client,
          });
        } catch (_error) {
          throw new Error("Invalid API key or host");
        }
      },

      checkAuth: async () => {
        const state = get();

        // If user has enabled sources, they're considered "authenticated"
        // even if they don't have PostHog credentials
        if (state.enabledSources.length > 0) {
          // Restore OpenAI key if available
          if (state.encryptedOpenaiKey) {
            const decryptedOpenaiKey = await window.electronAPI.retrieveApiKey(
              state.encryptedOpenaiKey,
            );
            if (decryptedOpenaiKey) {
              set({ openaiApiKey: decryptedOpenaiKey });
            }
          }

          // If PostHog is enabled, verify credentials
          if (state.enabledSources.includes("posthog")) {
            if (state.encryptedKey) {
              const decryptedKey = await window.electronAPI.retrieveApiKey(
                state.encryptedKey,
              );

              if (decryptedKey) {
                try {
                  const client = new PostHogAPIClient(
                    decryptedKey,
                    state.apiHost,
                  );
                  const user = await client.getCurrentUser();

                  set({
                    apiKey: decryptedKey,
                    user,
                    isAuthenticated: true,
                    client,
                  });

                  return true;
                } catch {
                  // Invalid stored credentials
                  set({ encryptedKey: null, isAuthenticated: false });
                  return false;
                }
              }
            }
            // PostHog enabled but no valid credentials
            return false;
          }

          // Non-PostHog sources only - mark as authenticated
          set({ isAuthenticated: true });
          return true;
        }

        return false;
      },

      logout: () => {
        set({
          apiKey: null,
          encryptedKey: null,
          user: null,
          isAuthenticated: false,
          client: null,
          openaiApiKey: null,
          encryptedOpenaiKey: null,
        });
      },
    }),
    {
      name: "mission-control-auth",
      partialize: (state) => ({
        enabledSources: state.enabledSources,
        apiHost: state.apiHost,
        encryptedKey: state.encryptedKey,
        encryptedOpenaiKey: state.encryptedOpenaiKey,
      }),
    },
  ),
);
