import type { UserBasic } from "@posthog/shared/domain-types";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";

/** Members matching the query, best-first: name prefix, word prefix, email, substring. */
export function filterMentionCandidates(
  members: UserBasic[],
  query: string,
  limit = 8,
): UserBasic[] {
  const q = query.trim().toLowerCase();
  const scored: Array<{ member: UserBasic; score: number }> = [];
  for (const member of members) {
    const name = userDisplayName(member).toLowerCase();
    const email = member.email.toLowerCase();
    let score: number | null = null;
    if (!q || name.startsWith(q)) score = 0;
    else if (name.split(/\s+/).some((word) => word.startsWith(q))) score = 1;
    else if (email.startsWith(q)) score = 2;
    else if (name.includes(q) || email.includes(q)) score = 3;
    if (score !== null) scored.push({ member, score });
  }
  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        userDisplayName(a.member).localeCompare(userDisplayName(b.member)),
    )
    .slice(0, limit)
    .map((entry) => entry.member);
}
