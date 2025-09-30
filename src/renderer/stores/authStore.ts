import { PostHogAPIClient } from "@api/posthogClient";
import type { User } from "@shared/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  apiKey: string | null;
  apiHost: string;
  encryptedKey: string | null;
  user: User | null;
  isAuthenticated: boolean;
  client: PostHogAPIClient | null;

  setCredentials: (apiKey: string, apiHost: string) => Promise<void>;
  checkAuth: () => Promise<boolean>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      apiKey: null,
      apiHost: "https://app.posthog.com",
      encryptedKey: null,
      user: null,
      isAuthenticated: false,
      client: null,

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

        // Note: Environment variables are not available in renderer process
        // They need to be passed from main process if needed

        // Check stored encrypted key
        if (state.encryptedKey) {
          const decryptedKey = await window.electronAPI.retrieveApiKey(
            state.encryptedKey,
          );

          if (decryptedKey) {
            try {
              const client = new PostHogAPIClient(decryptedKey, state.apiHost);
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
            }
          }
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
        });
      },
    }),
    {
      name: "mission-control-auth",
      partialize: (state) => ({
        apiHost: state.apiHost,
        encryptedKey: state.encryptedKey,
      }),
    },
  ),
);
