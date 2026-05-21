import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../stores/authStore";

export interface ProjectSummary {
  id: number;
  name: string;
}

/**
 * Fetch the display name for every team/project the OAuth token is scoped to,
 * so the settings project picker can show names instead of bare IDs. There is
 * no list endpoint scoped to a token's teams, so we fetch each
 * `/api/projects/{id}/` individually. A failed lookup degrades to `Project N`
 * rather than dropping the project from the list.
 */
export function useProjectsQuery() {
  const { cloudRegion, oauthAccessToken, scopedTeams, getCloudUrlFromRegion } =
    useAuthStore();

  return useQuery({
    queryKey: ["projects", cloudRegion, scopedTeams],
    queryFn: async (): Promise<ProjectSummary[]> => {
      if (!cloudRegion) throw new Error("No cloud region");
      const baseUrl = getCloudUrlFromRegion(cloudRegion);

      return Promise.all(
        scopedTeams.map(async (id): Promise<ProjectSummary> => {
          try {
            const response = await fetch(`${baseUrl}/api/projects/${id}/`, {
              headers: { Authorization: `Bearer ${oauthAccessToken}` },
            });
            if (!response.ok) return { id, name: `Project ${id}` };
            const data: { name?: string } = await response.json();
            return { id, name: data.name || `Project ${id}` };
          } catch {
            return { id, name: `Project ${id}` };
          }
        }),
      );
    },
    enabled: !!cloudRegion && !!oauthAccessToken && scopedTeams.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
