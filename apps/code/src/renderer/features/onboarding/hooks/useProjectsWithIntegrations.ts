import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import {
  AUTH_SCOPED_QUERY_META,
  useAuthStateFetched,
} from "@features/auth/hooks/authQueries";
import type { Integration } from "@features/integrations/stores/integrationStore";
import { useProjects } from "@features/projects/hooks/useProjects";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

export interface ProjectWithIntegrations {
  id: number;
  name: string;
  organization: { id: string; name: string };
  integrations: Integration[];
  hasGithubIntegration: boolean;
}

export function useProjectsWithIntegrations() {
  const { projects } = useProjects();
  const projectsLoading = !useAuthStateFetched();
  const client = useOptionalAuthenticatedClient();

  // Fetch integrations for each project in parallel
  const integrationQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ["integrations", project.id],
      queryFn: async () => {
        if (!client) throw new Error("Not authenticated");
        return client.getIntegrationsForProject(project.id);
      },
      enabled: !!client && projects.length > 0,
      staleTime: 60 * 1000, // 1 minute
      meta: AUTH_SCOPED_QUERY_META,
    })),
  });

  const isLoading =
    projectsLoading || integrationQueries.some((q) => q.isLoading);
  const isFetching = integrationQueries.some((q) => q.isFetching);

  const projectsWithIntegrations: ProjectWithIntegrations[] = useMemo(() => {
    return projects
      .map((project, index) => {
        const integrations = (integrationQueries[index]?.data ??
          []) as Integration[];
        const hasGithubIntegration = integrations.some(
          (i) => i.kind === "github",
        );
        return {
          ...project,
          integrations,
          hasGithubIntegration,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [projects, integrationQueries]);

  const projectsWithGithub = useMemo(
    () => projectsWithIntegrations.filter((p) => p.hasGithubIntegration),
    [projectsWithIntegrations],
  );

  return {
    projects: projectsWithIntegrations,
    projectsWithGithub,
    isLoading,
    isFetching,
  };
}
