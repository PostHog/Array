/**
 * Format a timestamp as a short relative string (e.g. "3m", "2h", "5d").
 * Accepts either a Unix ms timestamp or an ISO date string.
 */
export function formatRelativeTimeShort(timestamp: number | string): string {
  const ms =
    typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp;
  const diff = Date.now() - ms;

  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years}y`;
  if (months > 0) return `${months}mo`;
  if (weeks > 0) return `${weeks}w`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return "now";
}

/**
 * Format a timestamp as a longer relative string (e.g. "3 minutes ago", "1 day ago").
 * Falls back to a locale date for anything older than a week.
 * Accepts either a Unix ms timestamp or an ISO date string.
 */
export function formatRelativeTimeLong(timestamp: number | string): string {
  const date =
    typeof timestamp === "string" ? new Date(timestamp) : new Date(timestamp);
  const diff = Date.now() - date.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60)
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function getRelativeDateGroup(
  timestamp: number | string,
): string | null {
  const date = new Date(timestamp);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfDate = new Date(date);
  startOfDate.setHours(0, 0, 0, 0);
  const days = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000,
  );
  if (days <= 0) return null;
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  if (days < 30) return "This month";
  return "Earlier";
}
