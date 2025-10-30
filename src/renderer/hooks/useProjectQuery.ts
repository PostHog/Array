import { useAuthStore } from "@features/auth/stores/authStore";
import { useAuthenticatedQuery } from "./useAuthenticatedQuery";

export function useProjectQuery() {
  const projectId = useAuthStore((state) => state.projectId);

  return useAuthenticatedQuery(
    ["project", projectId],
    async (client) => {
      if (!projectId) {
        throw new Error("No project ID available");
      }
      const data = await client.getProject(projectId);
      return data;
    },
    {
      staleTime: 5 * 60 * 1000,
      enabled: !!projectId,
    },
  );
}
