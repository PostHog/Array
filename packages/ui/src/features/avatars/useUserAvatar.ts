import type { OrganizationMemberBasic } from "@posthog/shared/domain-types";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

/** The user fields avatar resolution needs; `UserBasic` and the full user satisfy it. */
export interface AvatarUser {
  uuid?: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  /** Present on the full `/api/users/@me/` response, not on `UserBasic`. */
  avatar_url?: string | null;
}

// Same convention as PostHog cloud's ProfilePicture: Gravatar keyed by the
// account email, d=404 so accounts without one fall through to the initials
// fallback. Gravatar accepts SHA-256 hashes, which Web Crypto can compute —
// no md5 dependency needed.
export async function gravatarUrl(email: string): Promise<string | null> {
  // Web Crypto is present on desktop/web but not guaranteed on every mobile
  // JS runtime — without it there's just no Gravatar source.
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `https://www.gravatar.com/avatar/${hash}?s=96&d=404`;
}

/** uuid and lowercased email → avatar URL, for members who have set one. */
export function buildMemberAvatarIndex(
  members: OrganizationMemberBasic[],
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const member of members) {
    if (!member.avatar_url) continue;
    if (member.user?.uuid) index.set(member.user.uuid, member.avatar_url);
    if (member.user?.email) {
      index.set(member.user.email.toLowerCase(), member.avatar_url);
    }
  }
  return index;
}

// Shared with useOrgMembers (same key → one fetch); membership churn is slow.
const ORG_MEMBERS_QUERY_KEY = ["org-members"] as const;
const ORG_MEMBERS_STALE_MS = 5 * 60_000;

function useMemberAvatarIndex(): ReadonlyMap<string, string> | null {
  const query = useAuthenticatedQuery(
    ORG_MEMBERS_QUERY_KEY,
    (client) => client.listOrganizationMembers(),
    { staleTime: ORG_MEMBERS_STALE_MS },
  );
  const members = query.data;
  return useMemo(
    () => (members ? buildMemberAvatarIndex(members) : null),
    [members],
  );
}

/**
 * A user's profile photo URL: their own record's `avatar_url` when present,
 * their org-member personalization otherwise, Gravatar as the last source.
 * Null while resolving or when the user has none — callers keep their
 * initials fallback.
 */
export function useUserAvatar(
  user: AvatarUser | null | undefined,
): string | null {
  const memberIndex = useMemberAvatarIndex();
  const email = user?.email ?? null;
  const { data: gravatar } = useQuery({
    queryKey: ["gravatar-url", email],
    queryFn: () => (email ? gravatarUrl(email) : null),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (!user) return null;
  const fromMembers =
    (user.uuid ? memberIndex?.get(user.uuid) : undefined) ??
    (email ? memberIndex?.get(email.toLowerCase()) : undefined);
  return user.avatar_url ?? fromMembers ?? gravatar ?? null;
}
