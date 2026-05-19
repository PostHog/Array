import type { PostHogAPIClient } from "@renderer/api/posthogClient";
import { trpc, trpcClient } from "@renderer/trpc/client";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@utils/queryClient";

export type AuthState = Awaited<
  ReturnType<typeof trpcClient.auth.getState.query>
>;

export const AUTH_SCOPED_QUERY_META = {
  authScoped: true,
} as const;

export const ANONYMOUS_AUTH_STATE: AuthState = {
  status: "anonymous",
  bootstrapComplete: false,
  cloudRegion: null,
  projectId: null,
  availableProjectIds: [],
  availableOrgIds: [],
  hasCodeAccess: null,
  needsScopeReauth: false,
};

export const authKeys = {
  currentUsers: () => ["auth", "current-user"] as const,
  currentUser: (identity: string | null) =>
    [...authKeys.currentUsers(), identity ?? "anonymous"] as const,
};

function getAuthStateQueryOptions() {
  return trpc.auth.getState.queryOptions();
}

export async function fetchAuthState(): Promise<AuthState> {
  return await trpcClient.auth.getState.query();
}

export function getCachedAuthState(): AuthState {
  return (
    queryClient.getQueryData<AuthState>(trpc.auth.getState.queryKey()) ??
    ANONYMOUS_AUTH_STATE
  );
}

export async function refreshAuthStateQuery(): Promise<void> {
  await queryClient.invalidateQueries(trpc.auth.getState.pathFilter());
}

export function clearAuthScopedQueries(): void {
  queryClient.removeQueries({
    predicate: (query) => query.meta?.authScoped === true,
  });
}

export function getAuthIdentity(authState: AuthState): string | null {
  if (authState.status !== "authenticated" || !authState.cloudRegion) {
    return null;
  }

  return `${authState.cloudRegion}:${authState.projectId ?? "none"}`;
}

export function useAuthState() {
  return useQuery({
    ...getAuthStateQueryOptions(),
    placeholderData: ANONYMOUS_AUTH_STATE,
    refetchOnMount: true,
  });
}

export function useAuthStateFetched(): boolean {
  const { isFetched } = useAuthState();
  return isFetched;
}

export function useAuthStateValue<T>(selector: (state: AuthState) => T): T {
  const { data } = useAuthState();
  return selector(data ?? ANONYMOUS_AUTH_STATE);
}

export function useCurrentUser(options?: {
  enabled?: boolean;
  client?: PostHogAPIClient | null;
  refetchOnWindowFocus?: boolean | "always";
}) {
  const authState = useAuthStateValue((state) => state);
  const client = options?.client ?? null;
  const authIdentity = getAuthIdentity(authState);

  return useQuery({
    queryKey: authKeys.currentUser(authIdentity),
    queryFn: async () => {
      if (!client) {
        throw new Error("Not authenticated");
      }

      return await client.getCurrentUser();
    },
    enabled: !!client && !!authIdentity && (options?.enabled ?? true),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: options?.refetchOnWindowFocus,
    meta: AUTH_SCOPED_QUERY_META,
  });
}
