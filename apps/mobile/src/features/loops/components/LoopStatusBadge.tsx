import { Text } from "@components/text";
import { View } from "react-native";
import { getLoopLastRunPresentation } from "../utils/loopStatus";

interface LoopStatusBadgeProps {
  enabled: boolean;
  lastRunStatus: string | null;
}

export function LoopStatusBadge({
  enabled,
  lastRunStatus,
}: LoopStatusBadgeProps) {
  const runStatus = getLoopLastRunPresentation(lastRunStatus);

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
      {runStatus ? (
        <View className={`rounded px-1.5 py-0.5 ${runStatus.className}`}>
          <Text className={`text-xs ${runStatus.className.split(" ")[1]}`}>
            {runStatus.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
