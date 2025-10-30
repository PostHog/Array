import { useAuthenticatedQuery } from "./useAuthenticatedQuery";

export function useMeQuery() {
  return useAuthenticatedQuery(
    ["me"],
    async (client) => {
      const data = await client.getCurrentUser();
      return data;
    },
    { staleTime: 5 * 60 * 1000 },
  );
}
