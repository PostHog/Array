import type { GatewayLimitCause } from "@posthog/shared";
import { PRO_USAGE_MULTIPLIER } from "./usageDisplay";

export interface UsageLimitContent {
  title: string;
  description: string;
  /** Primary action label; null renders only the dismiss button. */
  actionLabel: string | null;
  dismissLabel: string;
}

/**
 * Maps a legacy bucket-only caller onto a usage-based cause: no exceeded
 * bucket means the org's credit bucket tripped the limit.
 */
export function deriveUsageLimitCause(
  cause: GatewayLimitCause | null,
  bucket: "burst" | "sustained" | null,
): GatewayLimitCause {
  if (cause) return cause;
  if (bucket === "burst") return "user_daily_limit";
  if (bucket === "sustained") return "user_monthly_limit";
  return "org_limit";
}

export function usageBasedLimitContent(args: {
  cause: GatewayLimitCause;
  model: string | null;
  resetLabel: string | null;
  /** usage.code_usage_billed — absent means unknown, not free. */
  billed: boolean | undefined;
}): UsageLimitContent {
  const { cause, model, resetLabel, billed } = args;

  if (cause === "model_gate") {
    return {
      title: "Unlock premium models",
      description: `${model ? `${model} isn't` : "This model isn't"} included in the free tier. Add a payment method to your organization to unlock all models — you only pay for what you use. You can keep working now by switching to an included model.`,
      actionLabel: "Add payment method",
      dismissLabel: "Not now",
    };
  }

  if (cause === "org_limit") {
    if (billed === false) {
      return {
        title: "Free usage used up",
        description:
          "Your organization has used its included PostHog Code usage for this billing period. Add a payment method to keep going — you only pay for what you use.",
        actionLabel: "Add payment method",
        dismissLabel: "Not now",
      };
    }
    return {
      title: "Organization usage limit reached",
      description:
        "Your organization has reached its PostHog Code spend limit for this billing period. Raise or remove the limit in your PostHog billing settings to keep going.",
      actionLabel: "Manage billing",
      dismissLabel: "Got it",
    };
  }

  const period = cause === "user_daily_limit" ? "daily" : "monthly";
  return {
    title: `Free ${period} limit reached`,
    description: `You've hit the free tier's ${period} usage limit.${
      resetLabel ? ` ${resetLabel}.` : ""
    } Add a payment method to your organization for uncapped usage-based access.`,
    actionLabel: "Add payment method",
    dismissLabel: "Not now",
  };
}

export function seatEraLimitContent(args: {
  bucket: "burst" | "sustained" | null;
  isPro: boolean;
  resetLabel: string | null;
}): UsageLimitContent {
  const { bucket, isPro, resetLabel } = args;
  const isDaily = bucket === "burst";
  const isMonthly = bucket === "sustained";

  const title = isDaily
    ? "Daily limit reached"
    : isMonthly && !isPro
      ? "You're out of usage for this month"
      : isMonthly
        ? "Monthly limit reached"
        : "Usage limit reached";

  const proCapLabel = isDaily
    ? "a daily usage cap"
    : isMonthly
      ? "a monthly usage cap"
      : "usage caps";
  const description = isPro
    ? `Your Pro plan has ${proCapLabel}.${resetLabel ? ` ${resetLabel}.` : ""}`
    : `You've hit your Free ${
        isDaily ? "daily" : isMonthly ? "monthly" : "usage"
      } limit. Upgrade to Pro for ${PRO_USAGE_MULTIPLIER}× more usage.`;

  return {
    title,
    description,
    actionLabel: isPro ? null : "See Pro",
    dismissLabel: isPro ? "Got it" : "Not now",
  };
}
