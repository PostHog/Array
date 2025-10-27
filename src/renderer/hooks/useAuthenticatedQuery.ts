import type { PostHogAPIClient } from "@api/posthogClient";
import { useAuthStore } from "@features/auth/stores/authStore";
import type {
  QueryKey,
  UseQueryOptions,
  UseQueryResult,
} from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";

type AuthenticatedQueryFn<T> = (client: PostHogAPIClient) => Promise<T>;

export function useAuthenticatedQuery<
  TData = unknown,
  TError = Error,
  TQueryKey extends QueryKey = QueryKey,
>(
  queryKey: TQueryKey,
  queryFn: AuthenticatedQueryFn<TData>,
  options?: Omit<
    UseQueryOptions<TData, TError, TData, TQueryKey>,
    "queryKey" | "queryFn" | "enabled"
  >,
): UseQueryResult<TData, TError> {
  const client = useAuthStore((state) => state.client);

  return useQuery({
    queryKey,
    queryFn: async () => {
      if (!client) throw new Error("Not authenticated");
      return await queryFn(client);
    },
    enabled: !!client,
    ...options,
  });
}
