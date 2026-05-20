import { Text } from "@components/text";
import { differenceInHours, format, formatDistanceToNow } from "date-fns";
import { Check } from "phosphor-react-native";
import { memo } from "react";
import { Pressable, View } from "react-native";
import { useThemeColors } from "@/lib/theme";
import type { Task } from "../types";
import { TaskStatusIcon } from "./TaskStatusIcon";

interface TaskItemProps {
  task: Task;
  onPress: (task: Task) => void;
  onLongPress?: (task: Task) => void;
  selectionMode?: boolean;
  selected?: boolean;
}

function TaskItemComponent({
  task,
  onPress,
  onLongPress,
  selectionMode = false,
  selected = false,
}: TaskItemProps) {
  const themeColors = useThemeColors();
  const createdAt = new Date(task.created_at);
  const hoursSinceCreated = differenceInHours(new Date(), createdAt);
  const timeDisplay =
    hoursSinceCreated < 24
      ? formatDistanceToNow(createdAt, { addSuffix: true })
      : format(createdAt, "MMM d");

  return (
    <Pressable
      onPress={() => onPress(task)}
      onLongPress={onLongPress ? () => onLongPress(task) : undefined}
      delayLongPress={300}
      className={`flex-row items-start gap-3 border-gray-6 border-b px-3 py-3 ${selected ? "bg-accent-3" : "active:bg-gray-3"}`}
    >
      {/* Status icon column (or selection checkbox in selection mode) */}
      <View className="mt-0.5 h-5 w-5 shrink-0 items-center justify-center">
        {selectionMode ? (
          <View
            className={`h-5 w-5 items-center justify-center rounded-full border ${selected ? "border-transparent" : "border-gray-7"}`}
            style={selected ? { backgroundColor: themeColors.accent[9] } : null}
          >
            {selected ? <Check size={12} color="#fff" weight="bold" /> : null}
          </View>
        ) : (
          <TaskStatusIcon task={task} size={16} />
        )}
      </View>

      {/* Content column */}
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Text
            className="flex-1 font-medium text-[14px] text-gray-12"
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {task.title}
          </Text>
          <Text className="shrink-0 text-[11px] text-gray-9">
            {timeDisplay}
          </Text>
        </View>

        {task.description ? (
          <Text
            className="mt-0.5 text-[12px] text-gray-10"
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {task.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export const TaskItem = memo(TaskItemComponent);
