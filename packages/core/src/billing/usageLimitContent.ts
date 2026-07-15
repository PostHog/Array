import type { GatewayLimitCause } from "@posthog/shared";

export interface UsageLimitContent {
  title: string;
  description: string;
  /** Primary action label; null renders only the dismiss button. */
  actionLabel: string | null;
  dismissLabel: string;
}

export function usageLimitContent(args: {
  cause: GatewayLimitCause | null;
  resetLabel: string | null;
  /** usage.code_usage_billed — absent means unknown, not free. */
  billed: boolean | undefined;
}): UsageLimitContent {
  const { cause, resetLabel, billed } = args;

  if (cause === "model_gate") {
    return {
      title: "Unlock premium models",
      description:
        "This model isn't included in the free tier. Add a payment method to your organization to unlock all models — you only pay for what you use. You can keep working now by switching to an included model.",
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

  // Not a billing denial (e.g. an upstream provider's own rate limit) —
  // don't send the user to billing for something billing can't fix.
  return {
    title: "Usage limit reached",
    description: `PostHog Code hit a usage limit.${
      resetLabel ? ` ${resetLabel}.` : ""
    } Please try again shortly.`,
    actionLabel: null,
    dismissLabel: "Got it",
  };
}
