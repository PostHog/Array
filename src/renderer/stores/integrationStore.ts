import type { RepositoryConfig } from "@shared/types";
import { create } from "zustand";
import { useAuthStore } from "./authStore";

interface Integration {
  id: number;
  kind: string;
  [key: string]: unknown;
}

interface IntegrationState {
  integrations: Integration[];
  repositories: RepositoryConfig[];
  isLoading: boolean;
  error: string | null;

  fetchIntegrations: () => Promise<void>;
  fetchRepositories: () => Promise<void>;
}

export const useIntegrationStore = create<IntegrationState>((set, get) => ({
  integrations: [],
  repositories: [],
  isLoading: false,
  error: null,

  fetchIntegrations: async () => {
    const client = useAuthStore.getState().client;
    if (!client) return;

    set({ isLoading: true, error: null });

    try {
      const integrations = await client.getIntegrations();
      set({ integrations, isLoading: false });

      const githubIntegration = integrations.find(
        (i: Integration) => i.kind === "github",
      );
      if (githubIntegration) {
        await get().fetchRepositories();
      }
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch integrations",
        isLoading: false,
      });
    }
  },

  fetchRepositories: async () => {
    const client = useAuthStore.getState().client;
    if (!client) return;

    const { integrations } = get();
    const githubIntegration = integrations.find((i) => i.kind === "github");

    if (!githubIntegration) {
      set({ repositories: [] });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const repos = await client.getGithubRepositories(githubIntegration.id);
      set({ repositories: repos, isLoading: false });
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch repositories",
        isLoading: false,
      });
    }
  },
}));
