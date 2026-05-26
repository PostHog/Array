import type { UsageOutput } from "@main/services/llm-gateway/schemas";

export function isUsageExceeded(usage: UsageOutput): boolean {
  return (
    usage.is_rate_limited || usage.sustained.exceeded || usage.burst.exceeded
  );
}

export function formatResetTime(
  resetAtIso: string | undefined,
  fallbackSeconds: number,
  now: number = Date.now(),
): string {
  const ms = resetAtIso
    ? Math.max(0, Date.parse(resetAtIso) - now)
    : Math.max(0, fallbackSeconds * 1000);

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
