import { ArrowSquareOut, CreditCard } from "@phosphor-icons/react";
import { USAGE_BILLING_FLAG } from "@posthog/shared";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { Button, Dialog, Flex, Text } from "@radix-ui/themes";
import { useEffect } from "react";
import { track } from "../../shell/analytics";
import { openExternalUrl } from "../../shell/openExternal";
import { getBillingUrl } from "../../utils/urls";
import { useAuthStateValue } from "../auth/store";
import { useFeatureFlag } from "../feature-flags/useFeatureFlag";
import { useBillingAnnouncementStore } from "./billingAnnouncementStore";

/**
 * One-time blocking announcement for the usage-based billing cutover: shown
 * on first launch after the flag flips, until the user acknowledges. The
 * acknowledgment is stamped on the person profile so support can audit it.
 */
export function UsageBillingAnnouncementModal() {
  const usageBillingEnabled = useFeatureFlag(USAGE_BILLING_FLAG);
  const acknowledged = useBillingAnnouncementStore((s) => s.acknowledged);
  const acknowledge = useBillingAnnouncementStore((s) => s.acknowledge);
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);
  const isLoggedIn = useAuthStateValue((state) => state.currentOrgId !== null);

  const isOpen = usageBillingEnabled && isLoggedIn && !acknowledged;

  useEffect(() => {
    if (isOpen) {
      track(ANALYTICS_EVENTS.UPGRADE_PROMPT_SHOWN, {
        surface: "billing_announcement",
      });
    }
  }, [isOpen]);

  const handleAcknowledge = () => {
    track(ANALYTICS_EVENTS.USAGE_BILLING_ANNOUNCEMENT_ACKNOWLEDGED, {
      $set: {
        code_usage_billing_acknowledged_at: new Date().toISOString(),
      },
    });
    acknowledge();
  };

  const handleManageBilling = () => {
    track(ANALYTICS_EVENTS.UPGRADE_PROMPT_CLICKED, {
      surface: "billing_announcement",
    });
    const billingUrl = getBillingUrl(cloudRegion);
    if (billingUrl) openExternalUrl(billingUrl);
  };

  return (
    <Dialog.Root open={isOpen}>
      <Dialog.Content
        maxWidth="480px"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <Flex direction="column" gap="3">
          <Flex align="center" gap="2">
            <CreditCard size={20} weight="bold" color="var(--accent-9)" />
            <Dialog.Title className="mb-0">
              PostHog Code billing has changed
            </Dialog.Title>
          </Flex>
          <Dialog.Description>
            <Text color="gray" className="text-sm">
              Seat-based plans are gone. PostHog Code is now usage-based — your
              organization pays for AI usage at cost, and you only pay for what
              you use.
            </Text>
          </Dialog.Description>
          <Flex direction="column" gap="2" className="text-sm">
            <Text>
              • Your organization's first <Text weight="medium">$20</Text> of
              usage each month is included.
            </Text>
            <Text>
              • Premium models (Claude, GPT) need a payment method on your
              organization; an open model stays available on the free tier.
            </Text>
            <Text>
              • Every organization starts with a{" "}
              <Text weight="medium">$50/month</Text> spend limit you can raise,
              lower, or remove in PostHog billing settings.
            </Text>
          </Flex>
          <Flex justify="end" gap="3" mt="2">
            <Button
              type="button"
              variant="soft"
              color="gray"
              onClick={handleManageBilling}
            >
              Manage billing
              <ArrowSquareOut size={12} />
            </Button>
            <Button type="button" onClick={handleAcknowledge}>
              Got it
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
