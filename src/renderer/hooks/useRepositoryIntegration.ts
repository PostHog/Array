import { useMemo } from "react";
import { formatRepoKey } from "../utils/repository";
import { useIntegrations, useRepositories } from "./useIntegrations";

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
