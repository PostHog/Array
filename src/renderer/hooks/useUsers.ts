import type { Schemas } from "@api/generated";
import { useUsersStore } from "@stores/usersStore";
import { useEffect } from "react";
import { useAuthenticatedQuery } from "./useAuthenticatedQuery";

export function useUsers() {
  const setUsers = useUsersStore((state) => state.setUsers);

  const query = useAuthenticatedQuery(
    ["users"],
    async (client) => {
      const data = await client.getUsers();
      return data as Schemas.UserBasic[];
    },
    { staleTime: 5 * 60 * 1000 },
  );

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
