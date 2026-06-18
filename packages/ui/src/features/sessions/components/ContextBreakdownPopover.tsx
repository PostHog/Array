import {
  CONTEXT_CATEGORIES,
  formatTokensCompact,
  getOverallUsageColor,
} from "@posthog/ui/features/sessions/contextColors";
import type { ContextUsage } from "@posthog/ui/features/sessions/hooks/useContextUsage";
import { Flex, Text } from "@radix-ui/themes";

interface ContextBreakdownPopoverProps {
  usage: ContextUsage;
}

export function ContextBreakdownPopover({
  usage,
}: ContextBreakdownPopoverProps) {
  const { used, size, percentage, breakdown } = usage;
  const fillColor = getOverallUsageColor(percentage);

  return (
    <Flex direction="column" gap="3" className="min-w-[280px]">
      <Flex align="center" justify="between">
        <Text className="font-medium text-(--gray-12) text-[13px]">
          Context
        </Text>
        <Text className="text-(--gray-10) text-[12px] tabular-nums">
          ~{formatTokensCompact(used)} / {formatTokensCompact(size)} tokens
        </Text>
      </Flex>

      <Text className="font-semibold text-(--gray-12) text-[15px]">
        {percentage}% full
      </Text>

      {breakdown ? (
        <SegmentedBar breakdown={breakdown} total={used} fallback={fillColor} />
      ) : (
        <SinglePercentBar percentage={percentage} color={fillColor} />
      )}

      {breakdown ? (
        <Flex direction="column" gap="2">
          {CONTEXT_CATEGORIES.filter((c) => breakdown[c.key] > 0).map((cat) => (
            <Flex
              key={cat.key}
              align="center"
              justify="between"
              className="text-[13px]"
            >
              <Flex align="center" gap="2">
                <span
                  className="inline-block size-2.5 rounded-sm"
                  style={{ backgroundColor: cat.color }}
                />
                <Text className="text-(--gray-12)">{cat.label}</Text>
              </Flex>
              <Text className="text-(--gray-11) tabular-nums">
                {formatTokensCompact(breakdown[cat.key])}
              </Text>
            </Flex>
          ))}
        </Flex>
      ) : (
        <Text className="text-(--gray-10) text-[12px]">
          Detailed breakdown available after the first response.
        </Text>
      )}
    </Flex>
  );
}

function SegmentedBar({
  breakdown,
  total,
  fallback,
}: {
  breakdown: NonNullable<ContextUsage["breakdown"]>;
  total: number;
  fallback: string;
}) {
  if (total <= 0) {
    return <div className="h-1.5 w-full rounded-full bg-(--gray-4)" />;
  }

  const segmentSum = CONTEXT_CATEGORIES.reduce(
    (acc, cat) => acc + Math.max(0, breakdown[cat.key]),
    0,
  );
  const denominator = Math.max(total, segmentSum);
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-(--gray-4)">
      {CONTEXT_CATEGORIES.map((cat) => {
        const value = breakdown[cat.key];
        if (value <= 0) return null;
        return (
          <div
            key={cat.key}
            style={{
              width: `${(value / denominator) * 100}%`,
              backgroundColor: cat.color || fallback,
            }}
          />
        );
      })}
    </div>
  );
}

function SinglePercentBar({
  percentage,
  color,
}: {
  percentage: number;
  color: string;
}) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-(--gray-4)">
      <div
        className="h-full rounded-full"
        style={{ width: `${percentage}%`, backgroundColor: color }}
      />
    </div>
  );
}
