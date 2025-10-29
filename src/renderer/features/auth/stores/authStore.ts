import { PostHogAPIClient } from "@api/posthogClient";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const RECALL_API_URL = "https://us-west-2.recall.ai";

interface AuthState {
  apiKey: string | null;
  apiHost: string;
  encryptedKey: string | null;
  isAuthenticated: boolean;
  client: PostHogAPIClient | null;
  openaiApiKey: string | null;
  encryptedOpenaiKey: string | null;
  defaultWorkspace: string | null;

  setCredentials: (apiKey: string, apiHost: string) => Promise<void>;
  setOpenAIKey: (apiKey: string) => Promise<void>;
  setDefaultWorkspace: (workspace: string) => void;
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
      defaultWorkspace: null,

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

          window.electronAPI
            .recallInitialize(RECALL_API_URL, apiKey, apiHost)
            .catch((error) => {
              console.error("[Auth] Failed to initialize Recall SDK:", error);
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

      setDefaultWorkspace: (workspace: string) => {
        set({ defaultWorkspace: workspace });
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

              window.electronAPI
                .recallInitialize(RECALL_API_URL, decryptedKey, state.apiHost)
                .catch((error) => {
                  console.error(
                    "[Auth] Failed to initialize Recall SDK:",
                    error,
                  );
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
        defaultWorkspace: state.defaultWorkspace,
      }),
    },
  ),
);
