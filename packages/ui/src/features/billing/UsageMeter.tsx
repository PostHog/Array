import { Flex, Progress, Text } from "@radix-ui/themes";

interface UsageMeterProps {
  label: string;
  percent: number;
  valueLabel: string;
  detail: string;
  color?: "red";
  // Where a boundary inside the limit falls (e.g. the end of the included
  // allowance), as a percent of the bar. Rendered as a notch over the track.
  markerPercent?: number;
}

export function UsageMeter({
  label,
  percent,
  valueLabel,
  detail,
  color,
  markerPercent,
}: UsageMeterProps) {
  const borderColor = color === "red" ? "var(--red-7)" : "var(--gray-5)";
  const showMarker =
    markerPercent != null && markerPercent > 0 && markerPercent < 100;

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
      <div className="relative">
        <Progress
          value={percent}
          size="2"
          color={color === "red" ? "red" : undefined}
        />
        {showMarker && (
          <div
            aria-hidden
            className="absolute inset-y-0 w-px bg-(--gray-1)"
            style={{ left: `${markerPercent}%` }}
          />
        )}
      </div>
      <Text className="text-(--gray-9) text-[13px]">{detail}</Text>
    </Flex>
  );
}
