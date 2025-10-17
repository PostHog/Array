import type { RepositoryConfig } from "@shared/types";

export const formatRepoKey = (org: string, repo: string): string =>
  `${org}/${repo}`;

export const parseRepoKey = (
  repoKey: string,
): { organization: string; repository: string } | null => {
  const [organization, repository] = repoKey.split("/");
  if (organization && repository) {
    return { organization, repository };
  }
  return null;
};

export const repoConfigToKey = (config?: RepositoryConfig): string => {
  if (!config?.organization || !config?.repository) return "";
  return formatRepoKey(config.organization, config.repository);
};

export const REPO_NOT_IN_INTEGRATION_WARNING =
  "This repository is not connected to your GitHub integration. Tasks which run in the cloud won't be able to create PRs.";
