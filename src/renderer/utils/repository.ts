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
  "This repository is not available in your GitHub integration. We won't be able to create PRs when running tasks in the cloud.";
