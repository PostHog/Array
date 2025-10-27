import { useAuthStore } from "@stores/authStore";
import { useQuery } from "@tanstack/react-query";

export function useUsers() {
  const client = useAuthStore((state) => state.client);

  return useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      if (!client) throw new Error("Not authenticated");
      return await client.getUsers();
    },
    enabled: !!client,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function getUserDisplayName(user: {
  first_name?: string;
  last_name?: string;
  email: string;
}): string {
  if (user.first_name && user.last_name) {
    return `${user.first_name} ${user.last_name}`;
  }
  if (user.first_name) {
    return user.first_name;
  }
  return user.email;
}
