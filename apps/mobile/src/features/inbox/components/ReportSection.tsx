import { Text } from "@components/text";
import { CaretDown, CaretRight } from "phosphor-react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useThemeColors } from "@/lib/theme";

interface ReportSectionProps {
  title: string;
  /** Appended to the title as `(n)` – omit for sections without a count. */
  count?: number;
  /** Icon rendered before the title (e.g. `<ClockCounterClockwise size={14} />`). */
  icon?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  /**
   * Controls rendered at the end of the header row, outside the disclosure so
   * they stay independently tappable.
   */
  rightSlot?: ReactNode;
  children: ReactNode;
}

/**
 * Collapsible section on the report detail screen (Summary, Reviewers,
 * Signals). Mirrors the desktop `DetailSection` disclosure so the same report
 * can be scanned the same way on either host. Expansion state is owned by the
 * caller – the Signals disclosure fires analytics when it opens.
 */
export function ReportSection({
  title,
  count,
  icon,
  expanded,
  onToggle,
  rightSlot,
  children,
}: ReportSectionProps) {
  const themeColors = useThemeColors();

  return (
    <View className="mb-4">
      <View className="mb-2 flex-row items-center gap-2">
        <Pressable
          onPress={onToggle}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          className="shrink flex-row items-center gap-1.5 py-1 active:opacity-60"
        >
          {expanded ? (
            <CaretDown size={14} color={themeColors.gray[12]} />
          ) : (
            <CaretRight size={14} color={themeColors.gray[12]} />
          )}
          {icon}
          <Text className="font-semibold text-[14px] text-gray-12">
            {count === undefined ? title : `${title} (${count})`}
          </Text>
        </Pressable>
        {rightSlot ? (
          <>
            <View className="flex-1" />
            {rightSlot}
          </>
        ) : null}
      </View>
      {expanded ? children : null}
    </View>
  );
}
