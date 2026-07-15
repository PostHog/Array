import type { UserBasic } from "@posthog/shared/domain-types";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useMemo } from "react";

// Membership churn is slow; one fetch per session window is plenty.
const ORG_MEMBERS_STALE_MS = 5 * 60_000;

export const ORG_MEMBERS_QUERY_KEY = ["org-members"] as const;

/** Members of the current organization, sorted by display name. */
export function useOrgMembers(options?: { enabled?: boolean }): {
  members: UserBasic[];
  isLoading: boolean;
} {
  const query = useAuthenticatedQuery(
    ORG_MEMBERS_QUERY_KEY,
    (client) => client.listOrganizationMembers(),
    {
      enabled: options?.enabled ?? true,
      staleTime: ORG_MEMBERS_STALE_MS,
    },
  );
  const members = useMemo(
    () =>
      (query.data ?? [])
        .map((member) => member.user)
        .filter((user) => !!user?.email)
        .sort((a, b) => userDisplayName(a).localeCompare(userDisplayName(b))),
    [query.data],
  );
  return { members, isLoading: query.isLoading };
}
