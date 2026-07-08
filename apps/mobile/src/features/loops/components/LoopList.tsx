import { Text } from "@components/text";
import { Plus } from "phosphor-react-native";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  View,
} from "react-native";
import { useThemeColors } from "@/lib/theme";
import { useLoops } from "../hooks/useLoops";
import type { Loop } from "../types";
import { LoopItem } from "./LoopItem";

interface LoopListProps {
  onLoopPress?: (loopId: string) => void;
  onCreateLoop?: () => void;
  /** Top inset so the list can scroll behind a floating header. */
  contentInsetTop?: number;
}

interface LoopSection {
  title: string;
  data: Loop[];
}

function EmptyLoopState({ onCreateLoop }: Pick<LoopListProps, "onCreateLoop">) {
  const themeColors = useThemeColors();

  return (
    <View className="flex-1 items-center justify-center p-6">
      <Text className="mb-2 text-center font-semibold text-gray-12 text-lg">
        No loops yet
      </Text>
      <Text className="mb-6 text-center text-gray-11 text-sm">
        Run an agent on a schedule, a GitHub event or your own API call
      </Text>
      {onCreateLoop && (
        <Pressable
          onPress={onCreateLoop}
          className="flex-row items-center gap-2 rounded-full px-6 py-3.5 active:opacity-80"
          style={{ backgroundColor: themeColors.accent[9] }}
        >
          <Plus size={18} color={themeColors.accent.contrast} weight="bold" />
          <Text className="font-semibold text-[15px] text-accent-contrast">
            New loop
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export function LoopList({
  onLoopPress,
  onCreateLoop,
  contentInsetTop = 0,
}: LoopListProps) {
  const { personalLoops, teamLoops, isLoading, error, refetch } = useLoops();
  const themeColors = useThemeColors();

  const handleRefresh = async () => {
    await refetch();
  };

  const handleLoopPress = (loop: Loop) => {
    onLoopPress?.(loop.id);
  };

  const sections: LoopSection[] = [
    ...(personalLoops.length > 0
      ? [{ title: "My loops", data: personalLoops }]
      : []),
    ...(teamLoops.length > 0 ? [{ title: "Team loops", data: teamLoops }] : []),
  ];

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

  if (isLoading && sections.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={themeColors.accent[9]} />
        <Text className="mt-4 text-gray-11">Loading loops...</Text>
      </View>
    );
  }

  if (sections.length === 0) {
    return <EmptyLoopState onCreateLoop={onCreateLoop} />;
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <LoopItem loop={item} onPress={handleLoopPress} />
      )}
      renderSectionHeader={({ section }) => (
        <View className="bg-background px-3 pt-3 pb-1.5">
          <Text
            className="font-medium text-[11px] text-gray-10 uppercase"
            style={{ letterSpacing: 0.5 }}
          >
            {section.title}
          </Text>
        </View>
      )}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={handleRefresh}
          tintColor={themeColors.accent[9]}
        />
      }
      stickySectionHeadersEnabled={false}
      contentContainerStyle={{
        paddingTop: contentInsetTop,
        paddingBottom: 100,
      }}
    />
  );
}
