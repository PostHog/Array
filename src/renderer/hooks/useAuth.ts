import { useAuthStore } from "@renderer/stores/authStore";
import type { User } from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export const authKeys = {
  all: ["auth"] as const,
  user: () => [...authKeys.all, "user"] as const,
};

export function useCurrentUser() {
  const client = useAuthStore((state) => state.client);

  return useQuery({
    queryKey: authKeys.user(),
    queryFn: async () => {
      if (!client) throw new Error("Not authenticated");
      return await client.getCurrentUser();
    },
    enabled: !!client,
  });
}

export function useCheckAuth() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      client: NonNullable<ReturnType<typeof useAuthStore.getState>["client"]>,
    ) => {
      const user = (await client.getCurrentUser()) as User;
      return user;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.user() });
    },
  });
}
