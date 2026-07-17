import { useQuery } from "@tanstack/react-query";

/** The user fields avatar resolution needs; `UserBasic` and the full user satisfy it. */
export interface AvatarUser {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
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

/**
 * A user's profile photo URL: the account's own `avatar_url` when the
 * backend serves one, Gravatar otherwise. Null while resolving or when the
 * user has neither — callers keep their initials fallback.
 */
export function useUserAvatar(
  user: AvatarUser | null | undefined,
): string | null {
  const email = user?.email ?? null;
  const { data } = useQuery({
    queryKey: ["gravatar-url", email],
    queryFn: () => (email ? gravatarUrl(email) : null),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return user?.avatar_url ?? data ?? null;
}
