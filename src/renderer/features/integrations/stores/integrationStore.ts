import type { RepositoryConfig } from "@shared/types";
import { formatRepoKey } from "@utils/repository";
import { create } from "zustand";

export interface Integration {
  id: number;
  kind: string;
  [key: string]: unknown;
}

interface IntegrationStore {
  integrations: Integration[];
  repositories: RepositoryConfig[];
  setIntegrations: (integrations: Integration[]) => void;
  setRepositories: (repositories: RepositoryConfig[]) => void;
}

interface IntegrationSelectors {
  githubIntegration: Integration | undefined;
  isRepoInIntegration: (repoKey: string) => boolean;
}

export const useIntegrationStore = create<IntegrationStore>((set) => ({
  integrations: [],
  repositories: [],
  setIntegrations: (integrations) => set({ integrations }),
  setRepositories: (repositories) => set({ repositories }),
}));

export const useIntegrationSelectors = (): IntegrationSelectors => {
  const integrations = useIntegrationStore((state) => state.integrations);
  const repositories = useIntegrationStore((state) => state.repositories);

  const githubIntegration = integrations.find((i) => i.kind === "github");

  const isRepoInIntegration = (repoKey: string) => {
    if (!repoKey) return true;
    return repositories.some(
      (r) => formatRepoKey(r.organization, r.repository) === repoKey,
    );
  };

  return {
    githubIntegration,
    isRepoInIntegration,
  };
};
