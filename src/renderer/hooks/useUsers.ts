import { useAuthStore } from "@features/auth/stores/authStore";
import { useUsersStore } from "@stores/usersStore";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

export function useUsers() {
  const client = useAuthStore((state) => state.client);
  const setUsers = useUsersStore((state) => state.setUsers);

  const query = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      if (!client) throw new Error("Not authenticated");
      return await client.getUsers();
    },
    enabled: !!client,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  useEffect(() => {
    if (query.data) {
      setUsers(query.data);
    }
  }, [query.data, setUsers]);

  return query;
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
