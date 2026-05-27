import { useUsageLimitStore } from "@features/billing/stores/usageLimitStore";
import { formatResetTime } from "@features/billing/utils";
import { useSettingsDialogStore } from "@features/settings/stores/settingsDialogStore";
import { useSeat } from "@hooks/useSeat";
import { WarningCircle } from "@phosphor-icons/react";
import { Button, Dialog, Flex, Text } from "@radix-ui/themes";
import { trpcClient } from "@renderer/trpc/client";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { track } from "@utils/analytics";
import { useEffect } from "react";

const SUPPORT_MAILTO =
  "mailto:charles@posthog.com?subject=PostHog%20Code%20%E2%80%94%20Pro%20usage%20limit";

export function UsageLimitModal() {
  const isOpen = useUsageLimitStore((s) => s.isOpen);
  const bucket = useUsageLimitStore((s) => s.bucket);
  const resetAt = useUsageLimitStore((s) => s.resetAt);
  const eventIsPro = useUsageLimitStore((s) => s.isPro);
  const hide = useUsageLimitStore((s) => s.hide);
  const { isPro: seatIsPro } = useSeat();
  const isPro = eventIsPro ?? seatIsPro;

  useEffect(() => {
    if (isOpen) {
      track(ANALYTICS_EVENTS.UPGRADE_PROMPT_SHOWN, {
        surface: "usage_limit_modal",
      });
    }
  }, [isOpen]);

  const handleUpgrade = () => {
    track(ANALYTICS_EVENTS.UPGRADE_PROMPT_CLICKED, {
      surface: "usage_limit_modal",
    });
    hide();
    useSettingsDialogStore.getState().open("plan-usage");
  };

  const handleSupport = () => {
    void trpcClient.os.openExternal.mutate({ url: SUPPORT_MAILTO });
  };

  const isDaily = bucket === "burst";
  const isMonthly = bucket === "sustained";
  const resetLabel = resetAt ? formatResetTime(resetAt) : null;

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
      } limit. Upgrade to Pro for 20x more usage.`;

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
            <Dialog.Title className="mb-0">{title}</Dialog.Title>
          </Flex>
          <Dialog.Description>
            <Text color="gray" className="text-sm">
              {description}
            </Text>
          </Dialog.Description>
          <Flex justify="end" gap="3" mt="2">
            {isPro ? (
              <>
                <Button
                  type="button"
                  variant="soft"
                  color="gray"
                  onClick={handleSupport}
                  mr="auto"
                >
                  Get support
                </Button>
                <Button type="button" onClick={hide}>
                  Got it
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="soft"
                  color="gray"
                  onClick={hide}
                >
                  Not now
                </Button>
                <Button type="button" onClick={handleUpgrade}>
                  See Pro
                </Button>
              </>
            )}
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
