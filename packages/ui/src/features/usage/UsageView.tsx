import { ChartLine } from "@phosphor-icons/react";
import {
  type SpendAnalysisWindow,
  windowToDays,
} from "@posthog/core/billing/spendAnalysisFormat";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@posthog/quill";
import { BILLING_FLAG } from "@posthog/shared";
import { UsageMeter } from "@posthog/ui/features/billing/UsageMeter";
import { useSeat } from "@posthog/ui/features/billing/useSeat";
import { useUsage } from "@posthog/ui/features/billing/useUsage";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { openSettings } from "@posthog/ui/features/settings/hooks/useOpenSettings";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import {
  Badge,
  Box,
  Button,
  Flex,
  ScrollArea,
  Spinner,
  Text,
} from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { SpendAnalysisSection } from "./components/SpendAnalysisSection";
import { useSpendAnalysisEnabled } from "./useSpendAnalysisEnabled";
import { useTrackUsageViewed } from "./useTrackUsageViewed";

export function UsageView() {
  const headerContent = useMemo(
    () => (
      <Flex align="center" gap="2" className="w-full min-w-0">
        <ChartLine size={12} className="shrink-0 text-gray-10" />
        <Text
          className="truncate whitespace-nowrap font-medium text-[13px]"
          title="Usage"
        >
          Usage
        </Text>
      </Flex>
    ),
    [],
  );
  useSetHeaderContent(headerContent);

  const billingEnabled = useFeatureFlag(BILLING_FLAG);
  const spendAnalysisEnabled = useSpendAnalysisEnabled();

  const { seat, isPro, planLabel, isLoading: seatLoading } = useSeat();
  const { usage, isLoading: usageLoading } = useUsage({
    enabled: billingEnabled && seat !== null,
  });

  const [spendWindow, setSpendWindow] = useState<SpendAnalysisWindow>("30d");

  useTrackUsageViewed({
    isLoading: billingEnabled && (seatLoading || usageLoading),
    isPro,
    sustainedUsedPercent: usage?.sustained.used_percent ?? null,
    burstUsedPercent: usage?.burst.used_percent ?? null,
    spendAnalysisWindowDays: windowToDays(spendWindow),
  });

  if (!billingEnabled && !spendAnalysisEnabled) {
    return (
      <Flex align="center" justify="center" className="h-full">
        <Empty className="mx-auto max-w-md py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartLine size={24} />
            </EmptyMedia>
            <EmptyTitle>Usage isn't available</EmptyTitle>
            <EmptyDescription>
              Usage reporting isn't enabled for your account yet.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Flex>
    );
  }

  return (
    <ScrollArea className="h-full w-full">
      <Box p="6" mx="auto" className="max-w-[960px]">
        <Flex direction="column" gap="5">
          {billingEnabled && (
            <Flex direction="column" gap="3">
              <Flex align="center" justify="between">
                <Flex align="center" gap="2">
                  <Text className="font-medium text-(--gray-9) text-sm">
                    Plan usage
                  </Text>
                  {seat !== null && (
                    <Badge variant="soft" radius="full">
                      {planLabel}
                    </Badge>
                  )}
                </Flex>
                <Button
                  size="1"
                  variant="outline"
                  onClick={() => openSettings("plan-usage")}
                >
                  Manage plan
                </Button>
              </Flex>
              {seatLoading || usageLoading ? (
                <Flex
                  align="center"
                  justify="center"
                  p="4"
                  className="rounded-(--radius-3) border border-(--gray-5)"
                >
                  <Spinner size="2" />
                </Flex>
              ) : usage ? (
                <Flex direction="column" gap="3">
                  <UsageMeter
                    label="Monthly"
                    bucket={usage.sustained}
                    color={usage.sustained.exceeded ? "red" : undefined}
                  />
                  <UsageMeter
                    label="Daily"
                    bucket={usage.burst}
                    color={usage.burst.exceeded ? "red" : undefined}
                  />
                </Flex>
              ) : (
                <Flex
                  direction="column"
                  gap="3"
                  p="4"
                  className="rounded-(--radius-3) border border-(--gray-5)"
                >
                  <Text color="gray" className="text-sm">
                    Unable to load usage data
                  </Text>
                </Flex>
              )}
            </Flex>
          )}

          {spendAnalysisEnabled && (
            <SpendAnalysisSection
              window={spendWindow}
              onWindowChange={setSpendWindow}
            />
          )}
        </Flex>
      </Box>
    </ScrollArea>
  );
}
