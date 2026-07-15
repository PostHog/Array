import { ClockCounterClockwise } from "@phosphor-icons/react";
import {
  formatUsd,
  type SpendAnalysisFilledHour,
} from "@posthog/core/billing/spendAnalysisFormat";
import {
  type Series,
  TimeSeriesBarChart,
  useChartTheme,
} from "@posthog/quill-charts";
import { Flex, Spinner, Text } from "@radix-ui/themes";
import { useHourlyUsage } from "../useHourlyUsage";
import { UsageCard } from "./UsageCard";

interface HourlyUsageCardProps {
  product?: string;
}

// The component costs can undershoot cost_usd when the gateway priced an
// event via the token-estimation fallback (no per-side breakdown).
function otherCost(h: SpendAnalysisFilledHour): number {
  return Math.max(
    0,
    h.cost_usd -
      (h.input_cost_usd +
        h.output_cost_usd +
        h.cache_read_cost_usd +
        h.cache_creation_cost_usd),
  );
}

export function HourlyUsageCard({ product }: HourlyUsageCardProps) {
  const theme = useChartTheme();
  const { hours, isLoading, error } = useHourlyUsage({ product });

  // Older backends don't return by_hour — hide the card rather than erroring.
  if (!isLoading && !error && hours === null) {
    return null;
  }

  const series: Series[] = hours
    ? [
        {
          key: "cache_read",
          label: "Cache read",
          data: hours.map((h) => Math.max(0, h.cache_read_cost_usd)),
        },
        {
          key: "cache_write",
          label: "Cache write",
          data: hours.map((h) => Math.max(0, h.cache_creation_cost_usd)),
        },
        {
          key: "input",
          label: "Uncached input",
          data: hours.map((h) => Math.max(0, h.input_cost_usd)),
        },
        {
          key: "output",
          label: "Output",
          data: hours.map((h) => Math.max(0, h.output_cost_usd)),
        },
        {
          key: "other",
          label: "Uncategorized",
          data: hours.map(otherCost),
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
          Couldn't load hourly usage
        </Text>
      ) : hours ? (
        <>
          {/* flex-col + fixed height: the quill chart sizes its canvas by filling
              a flex-column parent; a plain block collapses it to 0. */}
          <div className="flex h-56 w-full flex-col">
            <TimeSeriesBarChart
              series={series}
              labels={hours.map((h) => h.hour)}
              config={{
                xAxis: { timezone: "UTC", interval: "hour" },
                yAxis: { tickFormatter: formatUsd },
                valueLabels: false,
                barCornerRadius: 2,
                showCrosshair: true,
              }}
              theme={theme}
            />
          </div>
          <Text className="text-(--gray-11) text-[13px]">
            Cost per hour, stacked by component. A bar dominated by cache write
            with little cache read usually means a cold session was revived —
            its whole context was re-written to the prompt cache at full price.
          </Text>
        </>
      ) : null}
    </UsageCard>
  );
}
