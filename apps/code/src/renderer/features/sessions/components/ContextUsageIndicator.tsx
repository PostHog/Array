import type { ContextUsage } from "@features/sessions/hooks/useContextUsage";
import {
  formatTokensCompact,
  getOverallUsageColor,
} from "@features/sessions/utils/contextColors";
import { Flex, Popover, Text } from "@radix-ui/themes";
import { ContextBreakdownPopover } from "./ContextBreakdownPopover";

const CIRCLE_SIZE = 20;
const STROKE_WIDTH = 2.5;
const RADIUS = (CIRCLE_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface ContextUsageIndicatorProps {
  usage: ContextUsage | null;
}

export function ContextUsageIndicator({ usage }: ContextUsageIndicatorProps) {
  if (!usage) return null;

  const { used, size, percentage } = usage;
  const strokeDashoffset = CIRCUMFERENCE - (percentage / 100) * CIRCUMFERENCE;
  const color = getOverallUsageColor(percentage);

  return (
    <Popover.Root>
      <Popover.Trigger>
        <button
          type="button"
          className="flex cursor-pointer select-none items-center gap-1 bg-transparent"
          aria-label={`Context usage: ${percentage}%`}
        >
          <Flex align="center" gap="1">
            <svg
              width={CIRCLE_SIZE}
              height={CIRCLE_SIZE}
              className="-rotate-90 shrink-0"
              role="img"
              aria-hidden="true"
            >
              <circle
                cx={CIRCLE_SIZE / 2}
                cy={CIRCLE_SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke="var(--gray-5)"
                strokeWidth={STROKE_WIDTH}
              />
              <circle
                cx={CIRCLE_SIZE / 2}
                cy={CIRCLE_SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={color}
                strokeWidth={STROKE_WIDTH}
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
              />
            </svg>
            <Text className="text-[13px] text-gray-10 tabular-nums">
              {formatTokensCompact(used)}/{formatTokensCompact(size)} ·{" "}
              {percentage}%
            </Text>
          </Flex>
        </button>
      </Popover.Trigger>
      <Popover.Content size="2" side="top" align="end" sideOffset={6}>
        <ContextBreakdownPopover usage={usage} />
      </Popover.Content>
    </Popover.Root>
  );
}
