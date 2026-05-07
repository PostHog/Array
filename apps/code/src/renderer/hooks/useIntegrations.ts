import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import { AUTH_SCOPED_QUERY_META } from "@features/auth/hooks/authQueries";
import {
  type Integration,
  useIntegrationSelectors,
  useIntegrationStore,
} from "@features/integrations/stores/integrationStore";
import type { UserGitHubIntegration } from "@renderer/api/posthogClient";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuthenticatedInfiniteQuery } from "./useAuthenticatedInfiniteQuery";
import { useAuthenticatedQuery } from "./useAuthenticatedQuery";

const integrationKeys = {
  all: ["integrations"] as const,
  list: () => [...integrationKeys.all, "list"] as const,
  repositories: (integrationId?: number) =>
    [...integrationKeys.all, "repositories", integrationId] as const,
  repositoryPicker: (integrationId?: number, search?: string, limit?: number) =>
    [
      ...integrationKeys.all,
      "repository-picker",
      integrationId,
      search,
      limit,
    ] as const,
  branches: (integrationId?: number, repo?: string | null, search?: string) =>
    [...integrationKeys.all, "branches", integrationId, repo, search] as const,
};

const userGithubIntegrationKeys = {
  all: ["user-github-integrations"] as const,
  list: () => [...userGithubIntegrationKeys.all, "list"] as const,
  repositories: (installationId?: string) =>
    [...userGithubIntegrationKeys.all, "repositories", installationId] as const,
  repositoryPicker: (
    installationId?: string,
    search?: string,
    limit?: number,
  ) =>
    [
      ...userGithubIntegrationKeys.all,
      "repository-picker",
      installationId,
      search,
      limit,
    ] as const,
  branches: (installationId?: string, repo?: string | null, search?: string) =>
    [
      ...userGithubIntegrationKeys.all,
      "branches",
      installationId,
      repo,
      search,
    ] as const,
};

interface UserRepositoryIntegrationRef {
  userIntegrationId: string;
  installationId: string;
}

export function useIntegrations() {
  const setIntegrations = useIntegrationStore((state) => state.setIntegrations);

  const query = useAuthenticatedQuery(
    integrationKeys.list(),
    (client) => client.getIntegrations() as Promise<Integration[]>,
  );

  useEffect(() => {
    if (query.data) {
      setIntegrations(query.data);
    }
  }, [query.data, setIntegrations]);

  return query;
}

function useAllGithubRepositories(githubIntegrations: Integration[]) {
  const client = useOptionalAuthenticatedClient();

  return useQueries({
    queries: githubIntegrations.map((integration) => ({
      queryKey: integrationKeys.repositories(integration.id),
      queryFn: async () => {
        if (!client) throw new Error("Not authenticated");
        const repos = await client.getGithubRepositories(integration.id);
        return { integrationId: integration.id, repos };
      },
      enabled: !!client,
      staleTime: 5 * 60 * 1000,
      meta: AUTH_SCOPED_QUERY_META,
    })),
    combine: (results) => {
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
    },
  });
}

export function useUserGithubIntegrations() {
  return useAuthenticatedQuery(userGithubIntegrationKeys.list(), (client) =>
    client.getGithubUserIntegrations(),
  );
}

function useAllUserGithubRepositories(
  githubIntegrations: UserGitHubIntegration[],
) {
  const client = useOptionalAuthenticatedClient();

  return useQueries({
    queries: githubIntegrations.map((integration) => ({
      queryKey: userGithubIntegrationKeys.repositories(
        integration.installation_id,
      ),
      queryFn: async () => {
        if (!client) throw new Error("Not authenticated");
        const repos = await client.getGithubUserRepositories(
          integration.installation_id,
        );
        return {
          userIntegrationId: integration.id,
          installationId: integration.installation_id,
          repos,
        };
      },
      enabled: !!client,
      staleTime: 5 * 60 * 1000,
      meta: AUTH_SCOPED_QUERY_META,
    })),
    combine: (results) => {
      const map: Record<string, UserRepositoryIntegrationRef> = {};
      const reposByInstallationId: Record<string, string[]> = {};
      const failedInstallationIds: string[] = [];
      let pending = false;
      results.forEach((result, index) => {
        if (result.isPending) pending = true;
        if (result.isError) {
          const installationId =
            githubIntegrations[index]?.installation_id ?? null;
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
    },
  });
}

const REPOSITORIES_PAGE_SIZE = 50;
const BRANCHES_FIRST_PAGE_SIZE = 50;
const BRANCHES_PAGE_SIZE = 100;

export function useGithubRepositories(
  search?: string,
  enabled: boolean = true,
) {
  const client = useOptionalAuthenticatedClient();
  const { githubIntegrations } = useIntegrationSelectors();
  const deferredSearch = useDeferredValue(search?.trim() ?? "");
  const [requestedLimit, setRequestedLimit] = useState(REPOSITORIES_PAGE_SIZE);
  const queryEnabled = enabled && !!client && githubIntegrations.length > 0;

  useEffect(() => {
    setRequestedLimit(REPOSITORIES_PAGE_SIZE);
  }, []);

  const { repositoryMap, isPending, isRefreshing, hasMore } = useQueries({
    queries: githubIntegrations.map((integration) => ({
      queryKey: integrationKeys.repositoryPicker(
        integration.id,
        deferredSearch,
        requestedLimit,
      ),
      queryFn: async () => {
        if (!client) throw new Error("Not authenticated");

        const page = await client.getGithubRepositoriesPage(
          integration.id,
          0,
          requestedLimit,
          deferredSearch,
        );

        return { integrationId: integration.id, ...page };
      },
      enabled: queryEnabled,
      staleTime: 5 * 60 * 1000,
      placeholderData: (prev: unknown) => prev,
      meta: AUTH_SCOPED_QUERY_META,
    })),
    combine: (results) => {
      const map: Record<string, number> = {};
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
            map[repo] = result.data.integrationId;
          }
        }
      }

      return {
        repositoryMap: map,
        isPending: pending,
        isRefreshing: refreshing,
        hasMore: hasMoreResults,
      };
    },
  });

  const loadMore = useCallback(() => {
    setRequestedLimit((currentLimit) => currentLimit + REPOSITORIES_PAGE_SIZE);
  }, []);

  return {
    repositories: Object.keys(repositoryMap),
    isPending: queryEnabled ? isPending : false,
    isRefreshing: queryEnabled ? isRefreshing : false,
    hasMore,
    loadMore,
  };
}

export function useUserGithubRepositories(
  search?: string,
  enabled: boolean = true,
) {
  const client = useOptionalAuthenticatedClient();
  const { data: githubIntegrations = [] } = useUserGithubIntegrations();
  const deferredSearch = useDeferredValue(search?.trim() ?? "");
  const [requestedLimit, setRequestedLimit] = useState(REPOSITORIES_PAGE_SIZE);
  const queryEnabled = enabled && !!client && githubIntegrations.length > 0;

  useEffect(() => {
    setRequestedLimit(REPOSITORIES_PAGE_SIZE);
  }, []);

  const { repositoryMap, isPending, isRefreshing, hasMore } = useQueries({
    queries: githubIntegrations.map((integration) => ({
      queryKey: userGithubIntegrationKeys.repositoryPicker(
        integration.installation_id,
        deferredSearch,
        requestedLimit,
      ),
      queryFn: async () => {
        if (!client) throw new Error("Not authenticated");

        const page = await client.getGithubUserRepositoriesPage(
          integration.installation_id,
          0,
          requestedLimit,
          deferredSearch,
        );

        return {
          userIntegrationId: integration.id,
          installationId: integration.installation_id,
          ...page,
        };
      },
      enabled: queryEnabled,
      staleTime: 5 * 60 * 1000,
      meta: AUTH_SCOPED_QUERY_META,
    })),
    combine: (results) => {
      const map: Record<string, UserRepositoryIntegrationRef> = {};
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
            map[repo] = {
              userIntegrationId: result.data.userIntegrationId,
              installationId: result.data.installationId,
            };
          }
        }
      }

      return {
        repositoryMap: map,
        isPending: pending,
        isRefreshing: refreshing,
        hasMore: hasMoreResults,
      };
    },
  });

  const loadMore = useCallback(() => {
    setRequestedLimit((currentLimit) => currentLimit + REPOSITORIES_PAGE_SIZE);
  }, []);

  return {
    repositories: Object.keys(repositoryMap),
    isPending: queryEnabled ? isPending : false,
    isRefreshing: queryEnabled ? isRefreshing : false,
    hasMore,
    loadMore,
  };
}

interface GithubBranchesPage {
  branches: string[];
  defaultBranch: string | null;
  hasMore: boolean;
}

export function useGithubBranches(
  integrationId?: number,
  repo?: string | null,
  search?: string,
  enabled: boolean = true,
) {
  const deferredSearch = useDeferredValue(search?.trim() ?? "");
  const queryEnabled = enabled && !!integrationId && !!repo;

  const query = useAuthenticatedInfiniteQuery<GithubBranchesPage, number>(
    integrationKeys.branches(integrationId, repo, deferredSearch),
    async (client, offset) => {
      if (!integrationId || !repo) {
        return { branches: [], defaultBranch: null, hasMore: false };
      }
      const pageSize =
        offset === 0 ? BRANCHES_FIRST_PAGE_SIZE : BRANCHES_PAGE_SIZE;
      return await client.getGithubBranchesPage(
        integrationId,
        repo,
        offset,
        pageSize,
        deferredSearch,
      );
    },
    {
      enabled: queryEnabled,
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) => {
        if (!lastPage.hasMore) return undefined;
        return allPages.reduce((n, p) => n + p.branches.length, 0);
      },
    },
  );

  const data = useMemo(() => {
    if (!query.data?.pages.length) {
      return { branches: [] as string[], defaultBranch: null };
    }
    return {
      branches: query.data.pages.flatMap((p) => p.branches),
      defaultBranch: query.data.pages[0]?.defaultBranch ?? null,
    };
  }, [query.data?.pages]);

  const loadMore = useCallback(() => {
    if (!query.hasNextPage || query.isFetchingNextPage) {
      return;
    }

    void query.fetchNextPage();
  }, [query.fetchNextPage, query.hasNextPage, query.isFetchingNextPage]);

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query.refetch]);

  return {
    data,
    isPending: queryEnabled ? query.isPending : false,
    isRefreshing: queryEnabled ? query.isRefetching : false,
    isFetchingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage ?? false,
    loadMore,
    refresh,
  };
}

export function useUserGithubBranches(
  installationId?: string,
  repo?: string | null,
  search?: string,
  enabled: boolean = true,
) {
  const deferredSearch = useDeferredValue(search?.trim() ?? "");
  const queryEnabled = enabled && !!installationId && !!repo;

  const query = useAuthenticatedInfiniteQuery<GithubBranchesPage, number>(
    userGithubIntegrationKeys.branches(installationId, repo, deferredSearch),
    async (client, offset) => {
      if (!installationId || !repo) {
        return { branches: [], defaultBranch: null, hasMore: false };
      }
      const pageSize =
        offset === 0 ? BRANCHES_FIRST_PAGE_SIZE : BRANCHES_PAGE_SIZE;
      return await client.getGithubUserBranchesPage(
        installationId,
        repo,
        offset,
        pageSize,
        deferredSearch,
      );
    },
    {
      enabled: queryEnabled,
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) => {
        if (!lastPage.hasMore) return undefined;
        return allPages.reduce((n, p) => n + p.branches.length, 0);
      },
    },
  );

  const data = useMemo(() => {
    if (!query.data?.pages.length) {
      return { branches: [] as string[], defaultBranch: null };
    }
    return {
      branches: query.data.pages.flatMap((p) => p.branches),
      defaultBranch: query.data.pages[0]?.defaultBranch ?? null,
    };
  }, [query.data?.pages]);

  const loadMore = useCallback(() => {
    if (!query.hasNextPage || query.isFetchingNextPage) {
      return;
    }

    void query.fetchNextPage();
  }, [query.fetchNextPage, query.hasNextPage, query.isFetchingNextPage]);

  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query.refetch]);

  return {
    data,
    isPending: queryEnabled ? query.isPending : false,
    isRefreshing: queryEnabled ? query.isRefetching : false,
    isFetchingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage ?? false,
    loadMore,
    refresh,
  };
}

export function useUserRepositoryIntegration() {
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();
  const { data: githubIntegrations = [], isPending: integrationsPending } =
    useUserGithubIntegrations();
  const [isRefreshingRepos, setIsRefreshingRepos] = useState(false);

  const {
    repositoryMap,
    reposByInstallationId,
    isPending: reposPending,
    failedInstallationIds,
  } = useAllUserGithubRepositories(githubIntegrations);

  const repositories = useMemo(
    () => Object.keys(repositoryMap),
    [repositoryMap],
  );

  const getUserIntegrationIdForRepo = useCallback(
    (repoKey: string) =>
      repositoryMap[repoKey?.toLowerCase()]?.userIntegrationId,
    [repositoryMap],
  );

  const getInstallationIdForRepo = useCallback(
    (repoKey: string) => repositoryMap[repoKey?.toLowerCase()]?.installationId,
    [repositoryMap],
  );

  const isRepoInIntegration = useCallback(
    (repoKey: string) => !repoKey || repoKey.toLowerCase() in repositoryMap,
    [repositoryMap],
  );

  const refreshRepositories = useCallback(async () => {
    if (!githubIntegrations.length || !client) {
      return;
    }

    setIsRefreshingRepos(true);

    try {
      await Promise.all(
        githubIntegrations.map((integration) =>
          client.refreshGithubUserRepositories(integration.installation_id),
        ),
      );

      await Promise.all(
        githubIntegrations.map((integration) =>
          queryClient.refetchQueries({
            queryKey: userGithubIntegrationKeys.repositories(
              integration.installation_id,
            ),
            exact: true,
          }),
        ),
      );

      await queryClient.refetchQueries({
        queryKey: [...userGithubIntegrationKeys.all, "repository-picker"],
      });
    } finally {
      setIsRefreshingRepos(false);
    }
  }, [client, githubIntegrations, queryClient]);

  return {
    repositories,
    getUserIntegrationIdForRepo,
    getInstallationIdForRepo,
    isRepoInIntegration,
    isLoadingRepos: integrationsPending || reposPending,
    isRefreshingRepos,
    refreshRepositories,
    hasGithubIntegration: githubIntegrations.length > 0,
    failedInstallationIds,
    reposByInstallationId,
  };
}

export function useRepositoryIntegration() {
  const client = useOptionalAuthenticatedClient();
  const queryClient = useQueryClient();
  const { isPending: integrationsPending } = useIntegrations();
  const { githubIntegrations, hasGithubIntegration } =
    useIntegrationSelectors();
  const [isRefreshingRepos, setIsRefreshingRepos] = useState(false);

  const { repositoryMap, isPending: reposPending } =
    useAllGithubRepositories(githubIntegrations);

  const repositories = useMemo(
    () => Object.keys(repositoryMap),
    [repositoryMap],
  );

  const getIntegrationIdForRepo = useCallback(
    (repoKey: string) => repositoryMap[repoKey?.toLowerCase()],
    [repositoryMap],
  );

  const isRepoInIntegration = useCallback(
    (repoKey: string) => !repoKey || repoKey.toLowerCase() in repositoryMap,
    [repositoryMap],
  );

  const refreshRepositories = useCallback(async () => {
    if (!githubIntegrations.length || !client) {
      return;
    }

    setIsRefreshingRepos(true);

    try {
      await Promise.all(
        githubIntegrations.map((integration) =>
          client.refreshGithubRepositories(integration.id),
        ),
      );

      await Promise.all(
        githubIntegrations.map((integration) =>
          queryClient.refetchQueries({
            queryKey: integrationKeys.repositories(integration.id),
            exact: true,
          }),
        ),
      );

      await queryClient.refetchQueries({
        queryKey: [...integrationKeys.all, "repository-picker"],
      });
    } finally {
      setIsRefreshingRepos(false);
    }
  }, [client, githubIntegrations, queryClient]);

  return {
    repositories,
    getIntegrationIdForRepo,
    isRepoInIntegration,
    isLoadingRepos: integrationsPending || reposPending,
    isRefreshingRepos,
    refreshRepositories,
    hasGithubIntegration,
  };
}
