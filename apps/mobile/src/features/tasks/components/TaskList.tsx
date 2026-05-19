import { Text } from "@components/text";
import { CaretRight, GitBranch } from "phosphor-react-native";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import { useThemeColors } from "@/lib/theme";
import { useIntegrations } from "../hooks/useIntegrations";
import { useTasks } from "../hooks/useTasks";
import { useArchivedTasksStore } from "../stores/archivedTasksStore";
import { taskActivityTimestamp, useTaskStore } from "../stores/taskStore";
import type { Task } from "../types";
import { GitHubConnectionPrompt } from "./GitHubConnectionPrompt";
import { GitHubLoadNotice } from "./GitHubLoadNotice";
import { SwipeableTaskItem } from "./SwipeableTaskItem";

interface TaskListProps {
  onTaskPress?: (taskId: string) => void;
  onCreateTask?: () => void;
  /** Top inset so the list can scroll behind a floating header. */
  contentInsetTop?: number;
}

interface CreateTaskEmptyStateProps {
  onCreateTask?: () => void;
}

function CreateTaskEmptyState({ onCreateTask }: CreateTaskEmptyStateProps) {
  const themeColors = useThemeColors();

  return (
    <View className="flex-1 items-center justify-center p-6">
      <View className="mb-6 h-16 w-16 items-center justify-center rounded-full bg-gray-3">
        <Text className="text-3xl">✨</Text>
      </View>
      <Text className="mb-2 text-center font-semibold text-gray-12 text-lg">
        No tasks yet
      </Text>
      <Text className="mb-6 text-center text-gray-11 text-sm">
        Create a task to get started
      </Text>
      {onCreateTask && (
        <Pressable
          onPress={onCreateTask}
          className="rounded-lg px-6 py-3"
          style={{ backgroundColor: themeColors.accent[9] }}
        >
          <Text className="font-semibold text-accent-contrast">
            Create task
          </Text>
        </Pressable>
      )}
    </View>
  );
}

type ListItem =
  | { type: "task"; task: Task; isArchived: boolean }
  | { type: "repo-header"; repoLabel: string; count: number }
  | { type: "date-header"; label: string; count: number }
  | { type: "archived-header"; count: number; expanded: boolean };

const NO_REPO_LABEL = "No repository";

function relativeDateGroup(ms: number): string {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfDate = new Date(ms);
  startOfDate.setHours(0, 0, 0, 0);
  const days = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000,
  );
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  if (days < 30) return "This month";
  return "Earlier";
}

const DATE_GROUP_ORDER = [
  "Today",
  "Yesterday",
  "This week",
  "This month",
  "Earlier",
];

export function TaskList({
  onTaskPress,
  onCreateTask,
  contentInsetTop = 0,
}: TaskListProps) {
  const { tasks, isLoading, error, refetch } = useTasks({
    originProduct: "user_created",
  });
  const {
    error: integrationsError,
    hasGithubIntegration,
    refetch: refetchIntegrations,
  } = useIntegrations();
  const themeColors = useThemeColors();
  const { archivedTasks, archive, unarchive } = useArchivedTasksStore();
  const organizeMode = useTaskStore((s) => s.organizeMode);
  const sortMode = useTaskStore((s) => s.sortMode);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const handleTaskPress = (task: Task) => {
    onTaskPress?.(task.id);
  };

  const handleRefresh = async () => {
    await Promise.all([refetch(), refetchIntegrations()]);
  };

  const listItems = useMemo((): ListItem[] => {
    const active: Task[] = [];
    const archived: Task[] = [];

    for (const task of tasks) {
      if (task.id in archivedTasks) {
        archived.push(task);
      } else {
        active.push(task);
      }
    }

    archived.sort(
      (a, b) => (archivedTasks[a.id] ?? 0) - (archivedTasks[b.id] ?? 0),
    );

    const items: ListItem[] = [];

    if (organizeMode === "by-project") {
      const groups = new Map<string, Task[]>();
      for (const task of active) {
        const key = task.repository?.trim() || NO_REPO_LABEL;
        const bucket = groups.get(key);
        if (bucket) {
          bucket.push(task);
        } else {
          groups.set(key, [task]);
        }
      }

      for (const tasksInRepo of groups.values()) {
        tasksInRepo.sort(
          (a, b) =>
            taskActivityTimestamp(b, sortMode) -
            taskActivityTimestamp(a, sortMode),
        );
      }

      const groupEntries = Array.from(groups.entries()).sort((a, b) => {
        if (a[0] === NO_REPO_LABEL) return 1;
        if (b[0] === NO_REPO_LABEL) return -1;
        return (
          taskActivityTimestamp(b[1][0], sortMode) -
          taskActivityTimestamp(a[1][0], sortMode)
        );
      });

      for (const [repoLabel, tasksInRepo] of groupEntries) {
        items.push({
          type: "repo-header",
          repoLabel,
          count: tasksInRepo.length,
        });
        for (const task of tasksInRepo) {
          items.push({ type: "task", task, isArchived: false });
        }
      }
    } else {
      const sorted = [...active].sort(
        (a, b) =>
          taskActivityTimestamp(b, sortMode) -
          taskActivityTimestamp(a, sortMode),
      );

      const buckets = new Map<string, Task[]>();
      for (const task of sorted) {
        const label = relativeDateGroup(taskActivityTimestamp(task, sortMode));
        const bucket = buckets.get(label);
        if (bucket) {
          bucket.push(task);
        } else {
          buckets.set(label, [task]);
        }
      }

      for (const label of DATE_GROUP_ORDER) {
        const bucket = buckets.get(label);
        if (!bucket || bucket.length === 0) continue;
        items.push({ type: "date-header", label, count: bucket.length });
        for (const task of bucket) {
          items.push({ type: "task", task, isArchived: false });
        }
      }
    }

    if (archived.length > 0) {
      items.push({
        type: "archived-header",
        count: archived.length,
        expanded: archivedExpanded,
      });

      if (archivedExpanded) {
        for (const task of archived) {
          items.push({ type: "task", task, isArchived: true });
        }
      }
    }

    return items;
  }, [tasks, archivedTasks, archivedExpanded, organizeMode, sortMode]);

  if (error) {
    return (
      <View className="flex-1 items-center justify-center p-6">
        <Text className="mb-4 text-center text-status-error">{error}</Text>
        <Pressable
          onPress={handleRefresh}
          className="rounded-lg bg-gray-3 px-4 py-2"
        >
          <Text className="text-gray-12">Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (integrationsError && tasks.length === 0) {
    return (
      <View className="flex-1 items-center justify-center p-6">
        <Text className="mb-4 text-center text-status-error">
          {integrationsError}
        </Text>
        <Pressable
          onPress={handleRefresh}
          className="rounded-lg bg-gray-3 px-4 py-2"
        >
          <Text className="text-gray-12">Retry</Text>
        </Pressable>
      </View>
    );
  }

  const isInitialLoading =
    (isLoading && tasks.length === 0) ||
    (tasks.length === 0 && hasGithubIntegration === null);

  if (isInitialLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={themeColors.accent[9]} />
        <Text className="mt-4 text-gray-11">Loading tasks...</Text>
      </View>
    );
  }

  if (hasGithubIntegration === false && tasks.length === 0) {
    return <GitHubConnectionPrompt mode="empty" onConnected={handleRefresh} />;
  }

  if (tasks.length === 0) {
    return <CreateTaskEmptyState onCreateTask={onCreateTask} />;
  }

  return (
    <FlatList
      scrollEnabled={scrollEnabled}
      data={listItems}
      keyExtractor={(item) => {
        switch (item.type) {
          case "archived-header":
            return "__archived_header__";
          case "repo-header":
            return `__repo__${item.repoLabel}`;
          case "date-header":
            return `__date__${item.label}`;
          case "task":
            return `${item.task.id}-${item.isArchived ? "a" : "v"}`;
        }
      }}
      ListHeaderComponent={
        integrationsError ? (
          <GitHubLoadNotice
            message={integrationsError}
            onRetry={handleRefresh}
          />
        ) : null
      }
      renderItem={({ item }) => {
        if (item.type === "repo-header") {
          return (
            <View className="flex-row items-center gap-2 bg-gray-2 px-3 py-2">
              <GitBranch size={14} color={themeColors.gray[10]} />
              <Text
                className="flex-1 font-medium text-[12px] text-gray-11"
                numberOfLines={1}
              >
                {item.repoLabel}
              </Text>
              <Text className="text-[11px] text-gray-9">{item.count}</Text>
            </View>
          );
        }

        if (item.type === "date-header") {
          return (
            <View className="flex-row items-center gap-2 bg-gray-2 px-3 py-2">
              <Text
                className="flex-1 font-medium text-[12px] text-gray-11 uppercase"
                style={{ letterSpacing: 0.5 }}
                numberOfLines={1}
              >
                {item.label}
              </Text>
              <Text className="text-[11px] text-gray-9">{item.count}</Text>
            </View>
          );
        }

        if (item.type === "archived-header") {
          return (
            <Pressable
              onPress={() => setArchivedExpanded(!item.expanded)}
              className="flex-row items-center gap-2 border-gray-6 border-t bg-gray-2 px-3 py-2.5"
            >
              <CaretRight
                size={14}
                color={themeColors.gray[9]}
                style={{
                  transform: [{ rotate: item.expanded ? "90deg" : "0deg" }],
                }}
              />
              <Text className="flex-1 font-medium text-gray-9 text-xs">
                Archived
              </Text>
              <Text className="text-gray-8 text-xs">{item.count}</Text>
            </Pressable>
          );
        }

        return (
          <SwipeableTaskItem
            task={item.task}
            isArchived={item.isArchived}
            onPress={handleTaskPress}
            onArchive={archive}
            onUnarchive={unarchive}
            onSwipeStart={() => setScrollEnabled(false)}
            onSwipeEnd={() => setScrollEnabled(true)}
          />
        );
      }}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={handleRefresh}
          tintColor={themeColors.accent[9]}
        />
      }
      contentContainerStyle={{
        paddingTop: contentInsetTop,
        paddingBottom: 100,
      }}
    />
  );
}
