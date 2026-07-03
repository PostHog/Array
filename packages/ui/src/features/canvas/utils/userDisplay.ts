import type { UserBasic } from "@posthog/shared/domain-types";

/**
 * Display helpers for a task/thread author's `UserBasic`. Shared by the
 * channel feed and the thread panel so kickoff messages and thread replies
 * render names and avatar initials identically.
 */
export function userDisplayName(user: UserBasic | null | undefined): string {
  if (!user) return "Unknown";
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return name || user.email;
}

export function userInitials(user: UserBasic | null | undefined): string {
  return userDisplayName(user).slice(0, 1).toUpperCase();
}
