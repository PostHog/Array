import { create } from "zustand";

export interface IntegrationAccount {
  name?: string;
  type?: string;
}

export interface IntegrationConfig {
  account?: IntegrationAccount;
  [key: string]: unknown;
}

export interface Integration {
  id: number;
  kind: string;
  config?: IntegrationConfig;
  display_name?: string;
  [key: string]: unknown;
}

interface IntegrationStore {
  integrations: Integration[];
  setIntegrations: (integrations: Integration[]) => void;
}

interface IntegrationSelectors {
  githubIntegrations: Integration[];
  hasGithubIntegration: boolean;
  slackIntegrations: Integration[];
  hasSlackIntegration: boolean;
}

export const useIntegrationStore = create<IntegrationStore>((set) => ({
  integrations: [],
  setIntegrations: (integrations) => set({ integrations }),
}));

export const useIntegrationSelectors = (): IntegrationSelectors => {
  const integrations = useIntegrationStore((state) => state.integrations);
  const githubIntegrations = integrations.filter((i) => i.kind === "github");
  const slackIntegrations = integrations.filter((i) => i.kind === "slack");

  return {
    githubIntegrations,
    hasGithubIntegration: githubIntegrations.length > 0,
    slackIntegrations,
    hasSlackIntegration: slackIntegrations.length > 0,
  };
};
