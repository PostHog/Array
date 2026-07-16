import type { UsageBucket, UsageOutput } from "../usage/schemas";

/**
 * The monthly usage allowance included for every org under Code usage
 * billing — the "first $20 each month is included" from the billing product
 * config. The gateway has no field for it: a subscribed org's
 * `ai_credits.limit_usd` arrives as one merged number (allowance + configured
 * spend limit), so display code peels the allowance back off with this
 * constant. If billing ever changes the allowance or starts sending a
 * breakdown, this constant (and the copy quoting $20) is the seam.
 */
export const CODE_INCLUDED_USAGE_USD = 20;

/** Confirmed free tier only — an absent `code_usage_subscribed` is unknown, never free. */
export function isCodeUsageFreeTier(
  usage: Pick<UsageOutput, "code_usage_subscribed"> | null | undefined,
): boolean {
  return usage?.code_usage_subscribed === false;
}

/**
 * The spend limit the org actually configured in billing settings ($50 by
 * default), recovered from the merged `limit_usd`. Null when it can't be
 * recovered: unconfirmed/free orgs (their limit IS the allowance), missing
 * numbers, or a merged limit below the allowance. Zero is a real answer — a
 * subscribed org whose merged limit equals the allowance set its spend limit
 * to $0.
 */
export function codeOrgSpendLimitUsd(
  usage:
    | Pick<UsageOutput, "code_usage_subscribed" | "ai_credits">
    | null
    | undefined,
): number | null {
  if (usage?.code_usage_subscribed !== true) return null;
  const limitUsd = usage.ai_credits?.limit_usd;
  if (limitUsd == null || limitUsd < CODE_INCLUDED_USAGE_USD) return null;
  // Round away float dust — the wire amounts are already cent-rounded.
  return Math.round((limitUsd - CODE_INCLUDED_USAGE_USD) * 100) / 100;
}

export interface CodeUsageBreakdown {
  includedUsd: number;
  spendLimitUsd: number;
}

export type CodeUsageMeter =
  | {
      kind: "dollars";
      usedUsd: number;
      limitUsd: number;
      percent: number;
      exceeded: boolean;
      resetAt: string;
      // How the merged limit decomposes for a subscribed org, so the meter
      // can explain "$70" as $20 included + $50 spend limit. Null when the
      // split is unknown (free tier, or a limit below the allowance).
      breakdown: CodeUsageBreakdown | null;
    }
  | { kind: "bucket"; bucket: UsageBucket }
  | { kind: "hidden" };

/**
 * What the usage meter should show. Billing's org-level dollars win when
 * present; a free-tier org without them falls back to its per-user valve
 * bucket; anything else shows nothing — per-user valve percentages are
 * meaningless for a subscribed org, and unknown must not render as free.
 */
export function codeUsageMeter(
  usage: UsageOutput | null | undefined,
): CodeUsageMeter {
  if (!usage) return { kind: "hidden" };
  const usedUsd = usage.ai_credits?.used_usd;
  const limitUsd = usage.ai_credits?.limit_usd;
  if (usedUsd != null && limitUsd != null && limitUsd > 0) {
    const spendLimitUsd = codeOrgSpendLimitUsd(usage);
    return {
      kind: "dollars",
      usedUsd,
      limitUsd,
      percent: Math.min(100, Math.round((usedUsd / limitUsd) * 100)),
      exceeded: usage.ai_credits?.exhausted === true,
      resetAt: usage.billing_period_end ?? usage.sustained.reset_at,
      breakdown:
        spendLimitUsd != null
          ? { includedUsd: CODE_INCLUDED_USAGE_USD, spendLimitUsd }
          : null,
    };
  }
  if (isCodeUsageFreeTier(usage)) {
    return { kind: "bucket", bucket: usage.sustained };
  }
  return { kind: "hidden" };
}

export function formatUsdAmount(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** One shared phrasing for the merged-limit explanation, e.g. "$20 included + $50 org spend limit". */
export function formatUsageBreakdown(breakdown: CodeUsageBreakdown): string {
  return `${formatUsdAmount(breakdown.includedUsd)} included + ${formatUsdAmount(breakdown.spendLimitUsd)} org spend limit`;
}

export function isUsageExceeded(usage: UsageOutput): boolean {
  return (
    usage.is_rate_limited || usage.sustained.exceeded || usage.burst.exceeded
  );
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
    let hours = Math.floor(totalHours);
    let minutes = Math.round((totalHours - hours) * 60);
    if (minutes === 60) {
      hours += 1;
      minutes = 0;
    }
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
