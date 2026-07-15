import type { UsageOutput } from "../usage/schemas";

/** How much more usage the Pro plan offers relative to the Free plan. */
export const PRO_USAGE_MULTIPLIER = 40;

export function isUsageExceeded(usage: UsageOutput): boolean {
  return (
    usage.is_rate_limited || usage.sustained.exceeded || usage.burst.exceeded
  );
}

/**
 * The org is confirmed on the free tier (not subscribed to Code usage
 * billing). False when subscribed OR when the state is unknown —
 * `code_usage_subscribed` is absent on gateways predating the field, and
 * absence must never read as free.
 */
export function isCodeUsageUnsubscribed(
  usage: Pick<UsageOutput, "code_usage_subscribed"> | null | undefined,
): boolean {
  return usage?.code_usage_subscribed === false;
}

export function formatResetTime(
  resetAtIso: string,
  now: number = Date.now(),
): string {
  const parsed = Date.parse(resetAtIso);
  const ms = Number.isNaN(parsed) ? 0 : Math.max(0, parsed - now);

  const totalMinutes = Math.ceil(ms / 60_000);
  if (totalMinutes <= 0) return "Resets shortly";
  if (totalMinutes < 60) return `Resets in ${totalMinutes}m`;

  const totalHours = ms / 3_600_000;
  if (totalHours < 24) {
    const hours = Math.floor(totalHours);
    const minutes = Math.round((totalHours - hours) * 60);
    return minutes === 0
      ? `Resets in ${hours}h`
      : `Resets in ${hours}h ${minutes}m`;
  }

  const target = new Date(now + ms);
  const date = target.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const time = target.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `Resets ${date} at ${time}`;
}
