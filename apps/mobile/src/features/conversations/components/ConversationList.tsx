import { Text } from "@components/text";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import { useThemeColors } from "@/lib/theme";
import { useConversations } from "../hooks/useConversations";
import type { ConversationDetail } from "../types";
import { ConversationItem } from "./ConversationItem";

interface ConversationListProps {
  onConversationPress?: (conversation: ConversationDetail) => void;
}

export function ConversationList({
  onConversationPress,
}: ConversationListProps) {
  const { conversations, isLoading, error, refetch } = useConversations();
  const themeColors = useThemeColors();

  const handleConversationPress = (conversation: ConversationDetail) => {
    onConversationPress?.(conversation);
  };

  const handleRetry = () => {
    void refetch();
  };

  if (error) {
    return (
      <View className="flex-1 items-center justify-center p-6">
        <Text className="mb-4 text-center text-status-error">{error}</Text>
        <Pressable
          onPress={handleRetry}
          className="rounded-lg bg-gray-3 px-4 py-2"
        >
          <Text className="text-gray-12">Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (isLoading && conversations.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color={themeColors.accent[9]} />
        <Text className="mt-4 text-gray-11">Loading conversations...</Text>
      </View>
    );
  }

  if (conversations.length === 0) {
    return (
      <View className="flex-1 items-center justify-center p-6">
        <Text className="text-center text-gray-11">No conversations yet</Text>
        <Text className="mt-2 text-center text-gray-9 text-sm">
          Start chatting with PostHog AI to see your conversations here
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={conversations}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <ConversationItem
          conversation={item}
          onPress={handleConversationPress}
        />
      )}
      refreshControl={
        <RefreshControl
          refreshing={isLoading}
          onRefresh={handleRetry}
          tintColor={themeColors.accent[9]}
        />
      }
      contentContainerStyle={{ paddingBottom: 100 }}
    />
  );
}
