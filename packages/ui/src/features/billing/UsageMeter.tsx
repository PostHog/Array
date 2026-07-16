import { Flex, Progress, Text } from "@radix-ui/themes";

interface UsageMeterProps {
  label: string;
  percent: number;
  valueLabel: string;
  detail: string;
  color?: "red";
}

export function UsageMeter({
  label,
  percent,
  valueLabel,
  detail,
  color,
}: UsageMeterProps) {
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
        <Text className="font-medium text-sm">{valueLabel}</Text>
      </Flex>
      <Progress
        value={percent}
        size="2"
        color={color === "red" ? "red" : undefined}
      />
      <Text className="text-(--gray-9) text-[13px]">{detail}</Text>
    </Flex>
  );
}
