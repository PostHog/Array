import { Robot } from "@phosphor-icons/react";
import {
  formatTokens,
  formatUsd,
} from "@posthog/core/billing/spendAnalysisFormat";
import type { SpendAnalysisModelRow } from "@posthog/core/billing/spendAnalysisTypes";
import { Flex, Text } from "@radix-ui/themes";
import { UsageCard } from "./UsageCard";

const DOT_COLORS = [
  "var(--accent-9)",
  "var(--blue-9)",
  "var(--purple-9)",
  "var(--amber-9)",
];

function ModelStat({ label, value }: { label: string; value: string }) {
  return (
    <Flex align="center" justify="between">
      <Text className="text-(--gray-9) text-[12px]">{label}</Text>
      <Text className="text-[12px]">{value}</Text>
    </Flex>
  );
}

interface ModelBreakdownCardsProps {
  rows: SpendAnalysisModelRow[];
  scopedCostUsd: number;
}

export function ModelBreakdownCards({
  rows,
  scopedCostUsd,
}: ModelBreakdownCardsProps) {
  if (rows.length === 0) return null;
  return (
    <UsageCard
      icon={<Robot size={14} className="text-(--gray-9)" />}
      title="Cost by model"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {rows.map((row, index) => {
          const share =
            scopedCostUsd > 0
              ? Math.round((row.cost_usd / scopedCostUsd) * 100)
              : 0;
          return (
            <Flex
              key={row.model ?? "(unknown)"}
              direction="column"
              gap="2"
              p="3"
              className="rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2)"
            >
              <Flex align="center" gap="2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: DOT_COLORS[index % DOT_COLORS.length],
                  }}
                />
                <Text className="truncate font-medium text-sm">
                  {row.model ?? "(unknown)"}
                </Text>
                <Flex flexGrow="1" />
                <Text className="font-semibold text-(--accent-11) text-sm">
                  {formatUsd(row.cost_usd)}
                </Text>
              </Flex>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <ModelStat
                  label="Input"
                  value={formatTokens(row.input_tokens)}
                />
                <ModelStat
                  label="Output"
                  value={formatTokens(row.output_tokens)}
                />
                <ModelStat
                  label="Generations"
                  value={row.generation_count.toLocaleString()}
                />
                <ModelStat label="Share" value={`${share}%`} />
              </div>
            </Flex>
          );
        })}
      </div>
    </UsageCard>
  );
}
