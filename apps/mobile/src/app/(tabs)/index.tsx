import { Text } from "@components/text";
import { Redirect, useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import {
  type ConversationDetail,
  ConversationList,
} from "@/features/conversations";
import { usePreferencesStore } from "@/features/preferences/stores/preferencesStore";

export default function ConversationsScreen() {
  const router = useRouter();
  const aiChatEnabled = usePreferencesStore((s) => s.aiChatEnabled);

  if (!aiChatEnabled) {
    return <Redirect href="/(tabs)/tasks" />;
  }

  const handleConversationPress = (conversation: ConversationDetail) => {
    router.push(`/chat/${conversation.id}`);
  };

  const handleNewChat = () => {
    router.push("/chat");
  };

  return (
    <View className="flex-1 bg-background">
      {/* Header */}
      <View className="border-gray-6 border-b px-4 pt-16 pb-4">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="font-semibold text-[22px] text-gray-12">
              Conversations
            </Text>
            <Text className="text-[13px] text-gray-11">
              Your PostHog AI chats
            </Text>
          </View>
          <Pressable
            onPress={handleNewChat}
            className="rounded-md bg-accent-9 px-3.5 py-2 active:opacity-80"
          >
            <Text className="font-semibold text-[13px] text-accent-contrast">
              New chat
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Conversation List */}
      <ConversationList onConversationPress={handleConversationPress} />
    </View>
  );
}
