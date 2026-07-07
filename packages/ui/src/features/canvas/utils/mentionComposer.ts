import { formatMention } from "@posthog/shared";
import type { UserBasic } from "@posthog/shared/domain-types";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";

/** The in-progress `@query` between the trigger and the caret. */
export interface ActiveMentionQuery {
  /** Index of the `@` in the full text. */
  start: number;
  query: string;
}

/**
 * The mention query the caret is inside, or null when the caret isn't in one.
 * The `@` must open a word (start of text or after whitespace); a query
 * starting with `[` is an already-inserted token, not a fresh trigger.
 */
export function findMentionQuery(
  text: string,
  caret: number,
): ActiveMentionQuery | null {
  const upToCaret = text.slice(0, caret);
  const start = upToCaret.lastIndexOf("@");
  if (start === -1) return null;
  if (start > 0 && !/\s/.test(upToCaret[start - 1] ?? "")) return null;
  const query = upToCaret.slice(start + 1);
  if (query.startsWith("[") || query.startsWith(" ")) return null;
  if (query.includes("\n") || query.length > 60) return null;
  return { start, query };
}

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

/** Replace the active `@query` with the member's mention token. */
export function applyMention(
  text: string,
  active: ActiveMentionQuery,
  caret: number,
  member: UserBasic,
): { text: string; caret: number } {
  const token = `${formatMention(userDisplayName(member), member.email)} `;
  const before = text.slice(0, active.start);
  const next = before + token + text.slice(caret);
  return { text: next, caret: before.length + token.length };
}
