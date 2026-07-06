import { formatResetTime } from "@posthog/core/billing/usageDisplay";
import type { UsageBucket } from "@posthog/core/usage/schemas";
import { Flex, Progress, Text } from "@radix-ui/themes";

interface UsageMeterProps {
  label: string;
  bucket: UsageBucket;
  color?: "red";
}

export function UsageMeter({ label, bucket, color }: UsageMeterProps) {
  const percentage = bucket.used_percent;

  const borderColor = color === "red" ? "var(--red-7)" : "var(--gray-5)";

  return (
    <Flex
      direction="column"
      gap="3"
      p="4"
      style={{
        border: `1px solid ${borderColor}`,
      }}
      className="rounded-(--radius-3)"
    >
      <Flex align="center" justify="between">
        <Text className="font-medium text-sm">{label}</Text>
        <Text className="font-medium text-sm">{percentage.toFixed(2)}%</Text>
      </Flex>
      <Progress
        value={percentage}
        size="2"
        color={color === "red" ? "red" : undefined}
      />
      <Text className="text-(--gray-9) text-[13px]">
        {`${bucket.exceeded ? "Limit exceeded. " : ""}${formatResetTime(bucket.reset_at)}`}
      </Text>
    </Flex>
  );
}
