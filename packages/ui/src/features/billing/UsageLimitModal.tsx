import { WarningCircle } from "@phosphor-icons/react";
import {
  formatResetTime,
  PRO_USAGE_MULTIPLIER,
} from "@posthog/core/billing/usageDisplay";
import { type GatewayLimitCause, USAGE_BILLING_FLAG } from "@posthog/shared";
import {
  ANALYTICS_EVENTS,
  type UpgradePromptCause,
} from "@posthog/shared/analytics-events";
import { Button, Dialog, Flex, Text } from "@radix-ui/themes";
import { useEffect } from "react";
import { track } from "../../shell/analytics";
import { openExternalUrl } from "../../shell/openExternal";
import { getBillingUrl } from "../../utils/urls";
import { useAuthStateValue } from "../auth/store";
import { useFeatureFlag } from "../feature-flags/useFeatureFlag";
import { openSettings } from "../settings/hooks/useOpenSettings";
import { useUsageLimitStore } from "./usageLimitStore";
import { useSeat } from "./useSeat";
import { useUsage } from "./useUsage";

const SUPPORT_MAILTO =
  "mailto:charles@posthog.com?subject=PostHog%20Code%20%E2%80%94%20Pro%20usage%20limit";

interface ModalContent {
  title: string;
  description: string;
  /** Primary action label; null renders only the dismiss button. */
  actionLabel: string | null;
  dismissLabel: string;
}

function usageBasedContent(args: {
  cause: GatewayLimitCause;
  model: string | null;
  resetLabel: string | null;
  billed: boolean | undefined;
}): ModalContent {
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

function seatEraContent(args: {
  bucket: "burst" | "sustained" | null;
  isPro: boolean;
  resetLabel: string | null;
}): ModalContent {
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

export function UsageLimitModal() {
  const isOpen = useUsageLimitStore((s) => s.isOpen);
  const bucket = useUsageLimitStore((s) => s.bucket);
  const resetAt = useUsageLimitStore((s) => s.resetAt);
  const eventIsPro = useUsageLimitStore((s) => s.isPro);
  const cause = useUsageLimitStore((s) => s.cause);
  const model = useUsageLimitStore((s) => s.model);
  const hide = useUsageLimitStore((s) => s.hide);
  const { isPro: seatIsPro } = useSeat();
  const usageBillingEnabled = useFeatureFlag(USAGE_BILLING_FLAG);
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);
  // Whether the org pays for Code usage — picks the org_limit copy variant.
  const { usage } = useUsage({ enabled: usageBillingEnabled && isOpen });
  const isPro = eventIsPro ?? seatIsPro;

  // Legacy callers only know the bucket; map it onto the usage-based cause.
  // No bucket exceeded means the org's credit bucket tripped the limit.
  const effectiveCause: GatewayLimitCause =
    cause ??
    (bucket === "burst"
      ? "user_daily_limit"
      : bucket === "sustained"
        ? "user_monthly_limit"
        : "org_limit");
  const trackedCause: UpgradePromptCause | undefined = usageBillingEnabled
    ? effectiveCause
    : undefined;

  useEffect(() => {
    if (isOpen) {
      track(ANALYTICS_EVENTS.UPGRADE_PROMPT_SHOWN, {
        surface: "usage_limit_modal",
        ...(trackedCause ? { cause: trackedCause } : {}),
      });
    }
  }, [isOpen, trackedCause]);

  const resetLabel = resetAt ? formatResetTime(resetAt) : null;

  const content = usageBillingEnabled
    ? usageBasedContent({
        cause: effectiveCause,
        model,
        resetLabel,
        billed: usage?.code_usage_billed,
      })
    : seatEraContent({ bucket, isPro, resetLabel });

  const handleAction = () => {
    track(ANALYTICS_EVENTS.UPGRADE_PROMPT_CLICKED, {
      surface: "usage_limit_modal",
      ...(trackedCause ? { cause: trackedCause } : {}),
    });
    hide();
    if (usageBillingEnabled) {
      // Payment methods and billing limits live on the PostHog billing page.
      const billingUrl = getBillingUrl(cloudRegion);
      if (billingUrl) openExternalUrl(billingUrl);
      return;
    }
    openSettings("plan-usage");
  };

  const handleSupport = () => {
    openExternalUrl(SUPPORT_MAILTO);
  };

  // Seat-era Pro keeps its support escape hatch; usage-based billing has no
  // Pro plan (support routes through the billing page instead).
  const showSupport = !usageBillingEnabled && isPro;

  return (
    <Dialog.Root open={isOpen}>
      <Dialog.Content
        maxWidth="400px"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={hide}
      >
        <Flex direction="column" gap="3">
          <Flex align="center" gap="2">
            <WarningCircle size={20} weight="bold" color="var(--red-9)" />
            <Dialog.Title className="mb-0">{content.title}</Dialog.Title>
          </Flex>
          <Dialog.Description>
            <Text color="gray" className="text-sm">
              {content.description}
            </Text>
          </Dialog.Description>
          <Flex justify="end" gap="3" mt="2">
            {showSupport && (
              <Button
                type="button"
                variant="soft"
                color="gray"
                onClick={handleSupport}
                mr="auto"
              >
                Get support
              </Button>
            )}
            <Button
              type="button"
              {...(content.actionLabel
                ? { variant: "soft" as const, color: "gray" as const }
                : {})}
              onClick={hide}
            >
              {content.dismissLabel}
            </Button>
            {content.actionLabel && (
              <Button type="button" onClick={handleAction}>
                {content.actionLabel}
              </Button>
            )}
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
