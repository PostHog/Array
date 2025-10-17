import { PostHogAPIClient } from "@api/posthogClient";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  apiKey: string | null;
  apiHost: string;
  encryptedKey: string | null;
  isAuthenticated: boolean;
  client: PostHogAPIClient | null;
  openaiApiKey: string | null;
  encryptedOpenaiKey: string | null;

  setCredentials: (apiKey: string, apiHost: string) => Promise<void>;
  setOpenAIKey: (apiKey: string) => Promise<void>;
  checkAuth: () => Promise<boolean>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      apiKey: null,
      apiHost: "https://us.posthog.com",
      encryptedKey: null,
      isAuthenticated: false,
      client: null,
      openaiApiKey: null,
      encryptedOpenaiKey: null,

      setCredentials: async (apiKey: string, apiHost: string) => {
        const encryptedKey = await window.electronAPI.storeApiKey(apiKey);

        const client = new PostHogAPIClient(apiKey, apiHost);

        try {
          await client.getCurrentUser();

          set({
            apiKey,
            apiHost,
            encryptedKey,
            isAuthenticated: true,
            client,
          });
        } catch (_error) {
          throw new Error("Invalid API key or host");
        }
      },

      setOpenAIKey: async (apiKey: string) => {
        const encryptedKey = await window.electronAPI.storeApiKey(apiKey);
        set({
          openaiApiKey: apiKey,
          encryptedOpenaiKey: encryptedKey,
        });
      },

      checkAuth: async () => {
        const state = get();

        // Check PostHog auth
        if (state.encryptedKey) {
          const decryptedKey = await window.electronAPI.retrieveApiKey(
            state.encryptedKey,
          );

          if (decryptedKey) {
            try {
              const client = new PostHogAPIClient(decryptedKey, state.apiHost);
              await client.getCurrentUser();

              set({
                apiKey: decryptedKey,
                isAuthenticated: true,
                client,
              });
            } catch {
              set({ encryptedKey: null, isAuthenticated: false });
            }
          }
        }

        // Check OpenAI key
        if (state.encryptedOpenaiKey) {
          const decryptedOpenaiKey = await window.electronAPI.retrieveApiKey(
            state.encryptedOpenaiKey,
          );

          if (decryptedOpenaiKey) {
            set({
              openaiApiKey: decryptedOpenaiKey,
            });
          }
        }

        return state.isAuthenticated;
      },

      logout: () => {
        set({
          apiKey: null,
          encryptedKey: null,
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
        apiHost: state.apiHost,
        encryptedKey: state.encryptedKey,
        encryptedOpenaiKey: state.encryptedOpenaiKey,
      }),
    },
  ),
);
