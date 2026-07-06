import { ChartLine, CreditCard, WarningCircle } from "@phosphor-icons/react";
import {
  fillSpendDays,
  type SpendAnalysisWindow,
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
  Callout,
  Flex,
  ScrollArea,
  Spinner,
  Text,
} from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { ModelBreakdownCards } from "./components/ModelBreakdownCards";
import {
  ProductBreakdownCard,
  ToolBreakdownCard,
} from "./components/SpendBreakdownTables";
import { SpendInsights } from "./components/SpendInsights";
import { SpendKpiStrip } from "./components/SpendKpiStrip";
import { SpendOverTimeCard } from "./components/SpendOverTimeCard";
import { UsageCard } from "./components/UsageCard";
import { WindowSelector } from "./components/WindowSelector";
import { useSpendAnalysis } from "./useSpendAnalysis";
import { useSpendAnalysisEnabled } from "./useSpendAnalysisEnabled";
import { useTrackUsageViewed } from "./useTrackUsageViewed";

const PRODUCT_SCOPE = "posthog_code";

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
  const { data, isLoading, isFetching, error, refetch } = useSpendAnalysis({
    window: spendWindow,
    product: PRODUCT_SCOPE,
  });

  const filledDays = useMemo(() => {
    if (!data?.by_day) return null;
    return fillSpendDays(
      data.by_day.items,
      data.summary.date_from,
      data.summary.date_to,
    );
  }, [data]);

  useTrackUsageViewed({
    isLoading: billingEnabled && (seatLoading || usageLoading),
    isPro,
    sustainedUsedPercent: usage?.sustained.used_percent ?? null,
    burstUsedPercent: usage?.burst.used_percent ?? null,
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
        <Flex direction="column" gap="4">
          <Flex align="center" gap="3">
            <Flex direction="column" gap="1" className="min-w-0">
              <Text className="font-semibold text-xl tracking-tight">
                Usage
              </Text>
              <Text className="text-(--gray-11) text-[13px]">
                Token spend and plan limits for PostHog Code
              </Text>
            </Flex>
            <Flex flexGrow="1" />
            {spendAnalysisEnabled && (
              <Flex align="center" gap="4">
                <WindowSelector value={spendWindow} onChange={setSpendWindow} />
                <Button
                  size="1"
                  variant="soft"
                  disabled={isFetching}
                  onClick={refetch}
                >
                  {isFetching && !isLoading ? <Spinner size="1" /> : "Refresh"}
                </Button>
              </Flex>
            )}
          </Flex>

          {spendAnalysisEnabled &&
            (error ? (
              <Callout.Root color="red" size="1">
                <Callout.Icon>
                  <WarningCircle size={16} />
                </Callout.Icon>
                <Callout.Text>
                  <Flex direction="column" gap="2">
                    <Text className="text-sm">
                      Couldn't load spend analysis
                    </Text>
                    <Text className="text-(--gray-11) text-[13px]">
                      {error}
                    </Text>
                    <Button
                      size="1"
                      variant="outline"
                      color="red"
                      onClick={refetch}
                      className="self-start"
                    >
                      Try again
                    </Button>
                  </Flex>
                </Callout.Text>
              </Callout.Root>
            ) : isLoading ? (
              <Flex
                align="center"
                justify="center"
                p="6"
                className="rounded-(--radius-3) border border-(--gray-5)"
              >
                <Spinner size="2" />
              </Flex>
            ) : data ? (
              <>
                <SpendKpiStrip data={data} filledDays={filledDays} />
                {filledDays && <SpendOverTimeCard filledDays={filledDays} />}
                <ModelBreakdownCards
                  rows={data.by_model.items}
                  scopedCostUsd={data.summary.scoped_cost_usd}
                />
              </>
            ) : null)}

          {billingEnabled && (
            <UsageCard
              icon={<CreditCard size={14} className="text-(--gray-9)" />}
              title="Plan limits"
              actions={
                <Flex align="center" gap="2">
                  {seat !== null && (
                    <Badge variant="soft" radius="full">
                      {planLabel}
                    </Badge>
                  )}
                  <Button
                    size="1"
                    variant="outline"
                    onClick={() => openSettings("plan-usage")}
                  >
                    Manage plan
                  </Button>
                </Flex>
              }
            >
              {seatLoading || usageLoading ? (
                <Flex align="center" justify="center" p="4">
                  <Spinner size="2" />
                </Flex>
              ) : usage ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                </div>
              ) : (
                <Text color="gray" className="text-sm">
                  Unable to load usage data
                </Text>
              )}
            </UsageCard>
          )}

          {spendAnalysisEnabled && data && (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ToolBreakdownCard rows={data.by_tool.items} />
                <ProductBreakdownCard rows={data.by_product.items} />
              </div>
              <SpendInsights data={data} />
            </>
          )}
        </Flex>
      </Box>
    </ScrollArea>
  );
}
