import {
  formatTokensCompact,
  getOverallUsageColor,
} from "@posthog/ui/features/sessions/contextColors";
import type { ContextUsage } from "@posthog/ui/features/sessions/hooks/useContextUsage";
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
  // The context window can be unknown (size 0) — show just the token count
  // rather than a misleading "X/0 · 0%".
  const hasSize = size > 0;
  const strokeDashoffset = CIRCUMFERENCE - (percentage / 100) * CIRCUMFERENCE;
  const color = getOverallUsageColor(percentage);

  return (
    <Popover.Root>
      <Popover.Trigger>
        <button
          type="button"
          className="flex cursor-pointer select-none items-center gap-1 bg-transparent"
          aria-label={
            hasSize
              ? `Context usage: ${percentage}%`
              : `Context usage: ${formatTokensCompact(used)} tokens`
          }
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
            <Text className="text-[13px] text-muted-foreground tabular-nums">
              {hasSize
                ? `${formatTokensCompact(used)}/${formatTokensCompact(size)} · ${percentage}%`
                : formatTokensCompact(used)}
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
