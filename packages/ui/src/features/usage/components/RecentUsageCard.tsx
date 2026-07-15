import { ClockCounterClockwise } from "@phosphor-icons/react";
import {
  formatUsd,
  type SpendAnalysisFilledBucket,
} from "@posthog/core/billing/spendAnalysisFormat";
import {
  type Series,
  TimeSeriesBarChart,
  useChartTheme,
} from "@posthog/quill-charts";
import { Flex, Spinner, Text } from "@radix-ui/themes";
import { useRecentUsage } from "../useRecentUsage";
import { UsageCard } from "./UsageCard";

interface RecentUsageCardProps {
  product?: string;
}

// The component costs can undershoot cost_usd when the gateway priced an
// event via the token-estimation fallback (no per-side breakdown).
function otherCost(b: SpendAnalysisFilledBucket): number {
  return Math.max(
    0,
    b.cost_usd -
      (b.input_cost_usd +
        b.output_cost_usd +
        b.cache_read_cost_usd +
        b.cache_creation_cost_usd),
  );
}

export function RecentUsageCard({ product }: RecentUsageCardProps) {
  const theme = useChartTheme();
  const { buckets, isLoading, error } = useRecentUsage({ product });

  // Older backends don't return by_bucket — hide the card rather than erroring.
  if (!isLoading && !error && buckets === null) {
    return null;
  }

  const series: Series[] = buckets
    ? [
        {
          key: "cache_read",
          label: "Cache read",
          data: buckets.map((b) => Math.max(0, b.cache_read_cost_usd)),
        },
        {
          key: "cache_write",
          label: "Cache write",
          data: buckets.map((b) => Math.max(0, b.cache_creation_cost_usd)),
        },
        {
          key: "input",
          label: "Uncached input",
          data: buckets.map((b) => Math.max(0, b.input_cost_usd)),
        },
        {
          key: "output",
          label: "Output",
          data: buckets.map((b) => Math.max(0, b.output_cost_usd)),
        },
        {
          key: "other",
          label: "Uncategorized",
          data: buckets.map(otherCost),
        },
      ]
    : [];

  return (
    <UsageCard
      icon={<ClockCounterClockwise size={14} className="text-(--accent-9)" />}
      title="Last 24 hours"
    >
      {isLoading ? (
        <Flex align="center" justify="center" p="6">
          <Spinner size="2" />
        </Flex>
      ) : error ? (
        <Text color="gray" className="text-sm">
          Couldn't load recent usage
        </Text>
      ) : buckets ? (
        <>
          {/* flex-col + fixed height: the quill chart sizes its canvas by filling
              a flex-column parent; a plain block collapses it to 0. */}
          <div className="flex h-56 w-full flex-col">
            <TimeSeriesBarChart
              series={series}
              labels={buckets.map((b) => b.bucket_start)}
              config={{
                xAxis: { timezone: "UTC", interval: "minute" },
                yAxis: { tickFormatter: formatUsd },
                valueLabels: false,
                barCornerRadius: 1,
                showCrosshair: true,
              }}
              theme={theme}
            />
          </div>
          <Text className="text-(--gray-11) text-[13px]">
            Cost per 5 minutes, stacked by component. A spike dominated by cache
            write with little cache read usually means a cold session was
            revived — its whole context was re-written to the prompt cache at
            full price.
          </Text>
        </>
      ) : null}
    </UsageCard>
  );
}
