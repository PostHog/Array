import { WarningCircle } from "@phosphor-icons/react";
import { formatResetTime } from "@posthog/core/billing/usageDisplay";
import {
  deriveUsageLimitCause,
  seatEraLimitContent,
  usageBasedLimitContent,
} from "@posthog/core/billing/usageLimitContent";
import { USAGE_BILLING_FLAG } from "@posthog/shared";
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

  const derivedCause = deriveUsageLimitCause(cause, bucket);
  const trackedCause: UpgradePromptCause | undefined =
    usageBillingEnabled && derivedCause ? derivedCause : undefined;

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
    ? usageBasedLimitContent({
        cause: derivedCause,
        model,
        resetLabel,
        billed: usage?.code_usage_billed,
      })
    : seatEraLimitContent({ bucket, isPro, resetLabel });

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
