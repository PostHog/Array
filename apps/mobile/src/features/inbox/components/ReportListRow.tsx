import { Text } from "@components/text";
import { differenceInHours, format, formatDistanceToNow } from "date-fns";
import { Eye, Lightning } from "phosphor-react-native";
import { memo } from "react";
import { Pressable, View } from "react-native";
import { useThemeColors } from "@/lib/theme";
import type { SignalReport, SignalReportActionability } from "../types";
import { inboxStatusLabel } from "../utils";

interface ReportListRowProps {
  report: SignalReport;
  onPress: (report: SignalReport) => void;
}

const statusColorMap: Record<string, { bg: string; text: string }> = {
  ready: { bg: "bg-status-success/20", text: "text-status-success" },
  pending_input: { bg: "bg-accent-3", text: "text-accent-11" },
  in_progress: { bg: "bg-status-warning/20", text: "text-status-warning" },
  candidate: { bg: "bg-status-info/20", text: "text-status-info" },
  potential: { bg: "bg-gray-5/20", text: "text-gray-9" },
  failed: { bg: "bg-status-error/20", text: "text-status-error" },
  suppressed: { bg: "bg-gray-5/20", text: "text-gray-9" },
  deleted: { bg: "bg-gray-5/20", text: "text-gray-9" },
};

const priorityColorMap: Record<string, { bg: string; text: string }> = {
  P0: { bg: "bg-status-error/20", text: "text-status-error" },
  P1: { bg: "bg-status-warning/20", text: "text-status-warning" },
  P2: { bg: "bg-status-warning/20", text: "text-status-warning" },
  P3: { bg: "bg-gray-5/20", text: "text-gray-9" },
  P4: { bg: "bg-gray-5/20", text: "text-gray-9" },
};

const actionabilityMap: Record<
  SignalReportActionability,
  { bg: string; text: string; label: string }
> = {
  immediately_actionable: {
    bg: "bg-status-success/20",
    text: "text-status-success",
    label: "Actionable",
  },
  requires_human_input: {
    bg: "bg-status-warning/20",
    text: "text-status-warning",
    label: "Needs input",
  },
  not_actionable: {
    bg: "bg-gray-5/20",
    text: "text-gray-9",
    label: "Not actionable",
  },
};

function ReportListRowComponent({ report, onPress }: ReportListRowProps) {
  const themeColors = useThemeColors();
  const updatedAt = new Date(report.updated_at);
  const hoursSince = differenceInHours(new Date(), updatedAt);
  const timeDisplay =
    hoursSince < 24
      ? formatDistanceToNow(updatedAt, { addSuffix: true })
      : format(updatedAt, "MMM d");

  const statusColors =
    statusColorMap[report.status] ?? statusColorMap.potential;

  return (
    <Pressable
      onPress={() => onPress(report)}
      className="border-gray-6 border-b px-3 py-3 active:bg-gray-3"
    >
      {/* Title — full wrap, no truncation */}
      <Text className="font-medium text-[14px] text-gray-12">
        {report.title ?? "Untitled signal"}
      </Text>

      {/* Badges + time */}
      <View className="mt-1.5 flex-row items-center gap-1.5">
        <View className={`rounded px-1.5 py-0.5 ${statusColors.bg}`}>
          <Text className={`text-[11px] ${statusColors.text}`}>
            {inboxStatusLabel(report.status)}
          </Text>
        </View>
        {report.priority && (
          <View
            className={`rounded px-1.5 py-0.5 ${(priorityColorMap[report.priority] ?? priorityColorMap.P3).bg}`}
          >
            <Text
              className={`font-medium text-[11px] ${(priorityColorMap[report.priority] ?? priorityColorMap.P3).text}`}
            >
              {report.priority}
            </Text>
          </View>
        )}
        {report.actionability && (
          <View
            className={`rounded px-1.5 py-0.5 ${actionabilityMap[report.actionability].bg}`}
          >
            <Text
              className={`text-[11px] ${actionabilityMap[report.actionability].text}`}
            >
              {actionabilityMap[report.actionability].label}
            </Text>
          </View>
        )}
        {report.is_suggested_reviewer && (
          <View className="rounded bg-status-warning/20 px-1 py-0.5">
            <Eye size={12} color={themeColors.status.warning} weight="bold" />
          </View>
        )}
        <View className="flex-1" />
        <View className="flex-row items-center gap-1">
          <Lightning size={11} color={themeColors.gray[9]} />
          <Text className="text-[11px] text-gray-9">{report.signal_count}</Text>
        </View>
        <Text className="text-[11px] text-gray-8">{timeDisplay}</Text>
      </View>
    </Pressable>
  );
}

export const ReportListRow = memo(ReportListRowComponent);
