import type { GatewayLimitCause } from "@posthog/shared";

export interface UsageLimitContent {
  title: string;
  description: string;
  actionLabel: string | null;
  dismissLabel: string;
}

export function usageLimitContent(args: {
  cause: GatewayLimitCause | null;
  resetLabel: string | null;
  subscribed: boolean | undefined;
}): UsageLimitContent {
  const { cause, resetLabel, subscribed } = args;

  if (cause === "model_gate") {
    return {
      title: "Unlock premium models",
      description:
        "To use this model, add a payment method to your account. Your first $20 of usage is on us each month - you only pay for what you use beyond that.\n\nOr, you can keep working now by switching to an open-source model.",
      actionLabel: "Add payment method",
      dismissLabel: "Not now",
    };
  }

  if (cause === "org_limit") {
    if (subscribed === false) {
      return {
        title: "Free usage used up",
        description: `Your organization has used up its included PostHog Code usage.${
          resetLabel ? ` ${resetLabel}.` : ""
        } Add a payment method to keep going.`,
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
