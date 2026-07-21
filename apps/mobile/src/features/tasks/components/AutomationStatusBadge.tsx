import { Text } from "@components/text";
import { getAutomationStatusPresentation } from "@posthog/core/automations/automationStatus";
import type { TaskRun } from "@posthog/shared";
import { View } from "react-native";

const STATUS_TONE_CLASSES = {
  neutral: "bg-gray-4 text-gray-11",
  warning: "bg-status-warning/20 text-status-warning",
  success: "bg-status-success/20 text-status-success",
  error: "bg-status-error/20 text-status-error",
} as const;

interface AutomationStatusBadgeProps {
  enabled: boolean;
  lastRunStatus: string | null;
  lastTaskRunStatus?: TaskRun["status"] | null;
}

export function AutomationStatusBadge({
  enabled,
  lastRunStatus,
  lastTaskRunStatus,
}: AutomationStatusBadgeProps) {
  const runStatus = getAutomationStatusPresentation({
    lastRunStatus,
    lastTaskRunStatus,
  });
  const runStatusClassName = runStatus
    ? STATUS_TONE_CLASSES[runStatus.tone]
    : null;

  return (
    <View className="flex-row flex-wrap gap-2">
      <View
        className={`rounded px-1.5 py-0.5 ${
          enabled ? "bg-accent-3" : "bg-gray-4"
        }`}
      >
        <Text
          className={`text-xs ${enabled ? "text-accent-11" : "text-gray-11"}`}
        >
          {enabled ? "Enabled" : "Paused"}
        </Text>
      </View>
      {runStatus && runStatusClassName ? (
        <View className={`rounded px-1.5 py-0.5 ${runStatusClassName}`}>
          <Text className={`text-xs ${runStatusClassName.split(" ")[1]}`}>
            {runStatus.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
