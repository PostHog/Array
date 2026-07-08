import { Text } from "@components/text";
import { format } from "date-fns";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useThemeColors } from "@/lib/theme";
import { useLoopRuns } from "../hooks/useLoops";
import type { LoopRun } from "../types";
import { getLoopRunStatusPresentation } from "../utils/loopStatus";

interface LoopRunHistoryProps {
  loopId: string;
  onRunPress?: (run: LoopRun) => void;
}

function LoopRunRow({
  run,
  onPress,
}: {
  run: LoopRun;
  onPress?: (run: LoopRun) => void;
}) {
  const presentation = getLoopRunStatusPresentation(run.status);

  return (
    <Pressable
      onPress={() => onPress?.(run)}
      disabled={!onPress}
      className="border-gray-6 border-b px-3 py-3 active:bg-gray-3"
    >
      <View className="flex-row items-center justify-between gap-3">
        <View className={`rounded px-1.5 py-0.5 ${presentation.className}`}>
          <Text className={`text-xs ${presentation.className.split(" ")[1]}`}>
            {presentation.label}
          </Text>
        </View>
        <Text className="text-gray-8 text-xs">
          {format(new Date(run.created_at), "MMM d, HH:mm")}
        </Text>
      </View>
      {run.branch && (
        <Text className="mt-1.5 text-gray-11 text-xs" numberOfLines={1}>
          {run.branch}
        </Text>
      )}
      {run.error_message && (
        <Text className="mt-1.5 text-status-error text-xs" numberOfLines={2}>
          {run.error_message}
        </Text>
      )}
    </Pressable>
  );
}

export function LoopRunHistory({ loopId, onRunPress }: LoopRunHistoryProps) {
  const themeColors = useThemeColors();
  const { data, isLoading, error, refetch } = useLoopRuns(loopId);
  const runs = data?.results ?? [];

  if (isLoading && runs.length === 0) {
    return (
      <View className="items-center py-8">
        <ActivityIndicator size="small" color={themeColors.accent[9]} />
        <Text className="mt-2 text-gray-11 text-sm">Loading runs...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="items-center py-8">
        <Text className="mb-3 text-center text-sm text-status-error">
          {error.message}
        </Text>
        <Pressable
          onPress={() => refetch()}
          className="rounded-lg bg-gray-3 px-4 py-2"
        >
          <Text className="text-gray-12">Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (runs.length === 0) {
    return (
      <View className="items-center py-8">
        <Text className="text-gray-11 text-sm">No runs yet</Text>
      </View>
    );
  }

  return (
    <View className="overflow-hidden rounded-xl border border-gray-6">
      {runs.map((run) => (
        <LoopRunRow key={run.id} run={run} onPress={onRunPress} />
      ))}
    </View>
  );
}
