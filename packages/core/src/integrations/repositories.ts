export interface RepositoryQueryResult<TData> {
  data: TData | undefined;
  isPending: boolean;
  isError: boolean;
  isRefetching: boolean;
}

export interface TeamRepositoriesResult {
  integrationId: number;
  repos?: string[] | null;
}

export interface CombinedTeamRepositories {
  repositoryMap: Record<string, number>;
  isPending: boolean;
}

export function combineGithubRepositories(
  results: ReadonlyArray<RepositoryQueryResult<TeamRepositoriesResult>>,
): CombinedTeamRepositories {
  const map: Record<string, number> = {};
  let pending = false;
  for (const result of results) {
    if (result.isPending) pending = true;
    if (!result.data) continue;
    for (const repo of result.data.repos ?? []) {
      if (!(repo in map)) {
        map[repo] = result.data.integrationId;
      }
    }
  }
  return { repositoryMap: map, isPending: pending };
}

export interface UserRepositoryIntegrationRef {
  userIntegrationId: string;
  installationId: string;
}

export interface UserRepositoriesResult {
  userIntegrationId: string;
  installationId: string;
  repos?: string[] | null;
}

export interface CombinedUserRepositories {
  repositoryMap: Record<string, UserRepositoryIntegrationRef>;
  reposByInstallationId: Record<string, string[]>;
  isPending: boolean;
  failedInstallationIds: string[];
}

export function combineUserGithubRepositories(
  results: ReadonlyArray<RepositoryQueryResult<UserRepositoriesResult>>,
  installationIds: ReadonlyArray<string | null | undefined>,
): CombinedUserRepositories {
  const map: Record<string, UserRepositoryIntegrationRef> = {};
  const reposByInstallationId: Record<string, string[]> = {};
  const failedInstallationIds: string[] = [];
  let pending = false;

  results.forEach((result, index) => {
    if (result.isPending) pending = true;
    if (result.isError) {
      const installationId = installationIds[index] ?? null;
      if (installationId) failedInstallationIds.push(installationId);
    }
    if (!result.data) return;
    const installationRepos = result.data.repos ?? [];
    reposByInstallationId[result.data.installationId] = installationRepos;
    for (const repo of installationRepos) {
      if (!(repo in map)) {
        map[repo] = {
          userIntegrationId: result.data.userIntegrationId,
          installationId: result.data.installationId,
        };
      }
    }
  });

  return {
    repositoryMap: map,
    reposByInstallationId,
    isPending: pending,
    failedInstallationIds,
  };
}

export interface RepositoryPageResult<TRef> {
  ref: TRef;
  repositories?: string[] | null;
  hasMore?: boolean;
}

export interface CombinedRepositoryPicker<TRef> {
  repositoryMap: Record<string, TRef>;
  isPending: boolean;
  isRefreshing: boolean;
  hasMore: boolean;
}

export function combineRepositoryPicker<TRef>(
  results: ReadonlyArray<RepositoryQueryResult<RepositoryPageResult<TRef>>>,
): CombinedRepositoryPicker<TRef> {
  const map: Record<string, TRef> = {};
  let pending = false;
  let refreshing = false;
  let hasMoreResults = false;

  for (const result of results) {
    if (result.isPending) pending = true;
    if (result.isRefetching) refreshing = true;
    if (!result.data) continue;

    if (result.data.hasMore) {
      hasMoreResults = true;
    }

    for (const repo of result.data.repositories ?? []) {
      if (!(repo in map)) {
        map[repo] = result.data.ref;
      }
    }
  }

  return {
    repositoryMap: map,
    isPending: pending,
    isRefreshing: refreshing,
    hasMore: hasMoreResults,
  };
}

export function normalizeRepoKey(repoKey: string | null | undefined): string {
  return repoKey?.toLowerCase() ?? "";
}

export function getRepoEntry<TRef>(
  repositoryMap: Record<string, TRef>,
  repoKey: string,
): TRef | undefined {
  return repositoryMap[normalizeRepoKey(repoKey)];
}

export function getIntegrationIdForRepo(
  repositoryMap: Record<string, number>,
  repoKey: string,
): number | undefined {
  return repositoryMap[normalizeRepoKey(repoKey)];
}

export function isRepoInIntegration(
  repositoryMap: Record<string, unknown>,
  repoKey: string,
): boolean {
  return !repoKey || normalizeRepoKey(repoKey) in repositoryMap;
}
