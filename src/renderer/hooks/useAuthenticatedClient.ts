import { useAuthStore } from "@features/auth/stores/authStore";

export function useAuthenticatedClient() {
  const client = useAuthStore((state) => state.client);

  if (!client) {
    throw new Error("Not authenticated");
  }

  return client;
}
