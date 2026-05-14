import { Text } from "@components/text";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Composer, MessagesList, useChatStore } from "@/features/chat";
import { useThemeColors } from "@/lib/theme";

export default function ChatDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const themeColors = useThemeColors();
  const [loadError, setLoadError] = useState<string | null>(null);

  const {
    thread,
    streamingActive,
    conversationLoading,
    askMax,
    stopGeneration,
    loadConversation,
    resetThread,
  } = useChatStore();

  useEffect(() => {
    if (!id) return;

    setLoadError(null);
    loadConversation(id).catch((err) => {
      console.error("Failed to load conversation:", err);
      setLoadError("Failed to load conversation");
    });

    return () => {
      // Reset when leaving the screen
      resetThread();
    };
  }, [id, loadConversation, resetThread]);

  const handleSend = useCallback(
    async (message: string) => {
      await askMax(message, id);
    },
    [askMax, id],
  );

  const handleOpenTask = useCallback(
    (taskId: string) => {
      router.push(`/task/${taskId}`);
    },
    [router],
  );

  const { height } = useReanimatedKeyboardAnimation();

  // useReanimatedKeyboardAnimation returns negative height values
  // e.g., -300 when keyboard is open, 0 when closed
  const contentPosition = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: height.value }],
    };
  }, []);

  const inputContainerStyle = useAnimatedStyle(() => {
    return {
      marginBottom: height.value < 0 ? 12 : insets.bottom,
    };
  }, [insets.bottom]);

  if (loadError) {
    return (
      <View className="flex-1 items-center justify-center bg-background px-4">
        <FloatingBackButton />
        <Text className="mb-4 text-center text-status-error">{loadError}</Text>
        <Pressable
          onPress={() => router.back()}
          className="rounded-lg bg-gray-3 px-4 py-2"
        >
          <Text className="text-gray-12">Go back</Text>
        </Pressable>
      </View>
    );
  }

  if (conversationLoading && thread.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <FloatingBackButton />
        <ActivityIndicator size="large" color={themeColors.accent[9]} />
        <Text className="mt-4 text-gray-11">Loading conversation...</Text>
      </View>
    );
  }

  return (
    <Animated.View className="flex-1 bg-background" style={contentPosition}>
      <FloatingBackButton />
      {streamingActive && (
        <Pressable
          onPress={stopGeneration}
          className="absolute right-3 z-10 px-2 py-1.5"
          style={{ top: insets.top + 10 }}
        >
          <Text className="font-medium text-[13px] text-status-error">
            Stop
          </Text>
        </Pressable>
      )}
      <MessagesList
        messages={thread}
        onOpenTask={handleOpenTask}
        contentContainerStyle={{
          paddingTop: insets.top + 56,
          paddingBottom: 16,
          flexGrow: thread.length === 0 ? 1 : undefined,
        }}
      />

      {/* Fixed input at bottom */}
      <Animated.View
        className="absolute inset-x-0 bottom-0"
        style={inputContainerStyle}
      >
        <Composer onSend={handleSend} disabled={streamingActive} />
      </Animated.View>
    </Animated.View>
  );
}
