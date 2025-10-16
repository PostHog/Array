import {
  useIntegrations,
  useRepositories,
} from "@renderer/hooks/useIntegrations";
import { formatRepoKey } from "@renderer/utils/repository";
import { useMemo } from "react";

export function useRepositoryIntegration() {
  const { data: integrations = [] } = useIntegrations();

  const githubIntegration = useMemo(
    () => integrations.find((i) => i.kind === "github"),
    [integrations],
  );

  const { data: repositories = [] } = useRepositories(githubIntegration?.id);

  const isRepoInIntegration = useMemo(
    () => (repoKey: string) => {
      if (!repoKey) return true;
      return repositories.some(
        (r) => formatRepoKey(r.organization, r.repository) === repoKey,
      );
    },
    [repositories],
  );

  return {
    githubIntegration,
    repositories,
    isRepoInIntegration,
  };
}
