import { Text } from "@components/text";
import { format, formatDistanceToNow } from "date-fns";
import { memo } from "react";
import { Pressable, View } from "react-native";
import type { Loop } from "../types";
import {
  getLoopSecondaryLabel,
  getLoopTriggerSummary,
} from "../utils/loopPresentation";
import { LoopStatusBadge } from "./LoopStatusBadge";

interface LoopItemProps {
  loop: Loop;
  onPress: (loop: Loop) => void;
}

function LoopItemComponent({ loop, onPress }: LoopItemProps) {
  const lastRunDisplay = loop.last_run_at
    ? new Date(loop.last_run_at).getTime() > Date.now() - 24 * 60 * 60 * 1000
      ? formatDistanceToNow(new Date(loop.last_run_at), { addSuffix: true })
      : format(new Date(loop.last_run_at), "MMM d")
    : "No runs yet";

  return (
    <Pressable
      onPress={() => onPress(loop)}
      className="border-gray-6 border-b px-3 py-3 active:bg-gray-3"
    >
      <View className="flex-row items-center justify-between gap-3">
        <Text
          className="flex-1 font-medium text-gray-12 text-sm"
          numberOfLines={1}
        >
          {loop.name}
        </Text>
        <Text className="text-gray-8 text-xs">{lastRunDisplay}</Text>
      </View>

      <View className="mt-1">
        <LoopStatusBadge
          enabled={loop.enabled}
          lastRunStatus={loop.last_run_status}
        />
      </View>

      <Text className="mt-2 text-gray-11 text-xs" numberOfLines={1}>
        {getLoopSecondaryLabel(loop)}
      </Text>
      <Text className="mt-0.5 text-gray-9 text-xs" numberOfLines={1}>
        {getLoopTriggerSummary(loop)}
      </Text>

      {loop.last_error && (
        <Text className="mt-2 text-status-error text-xs" numberOfLines={2}>
          {loop.last_error}
        </Text>
      )}
    </Pressable>
  );
}

export const LoopItem = memo(LoopItemComponent);
