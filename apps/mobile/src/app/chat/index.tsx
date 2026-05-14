import { Text } from "@components/text";
import { useCallback } from "react";
import { Pressable } from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingBackButton } from "@/components/FloatingBackButton";
import { Composer, MessagesList, useChatStore } from "@/features/chat";

export default function NewChatScreen() {
  const insets = useSafeAreaInsets();
  const { thread, streamingActive, askMax, stopGeneration, resetThread } =
    useChatStore();

  const handleSend = useCallback(
    async (message: string) => {
      await askMax(message);
    },
    [askMax],
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

  return (
    <Animated.View className="flex-1 bg-background" style={contentPosition}>
      <FloatingBackButton />
      {/* Top-right Stop / New action that used to live in the header. */}
      {(streamingActive || thread.length > 0) && (
        <Pressable
          onPress={streamingActive ? stopGeneration : resetThread}
          className="absolute right-3 z-10 px-2 py-1.5"
          style={{ top: insets.top + 10 }}
        >
          <Text
            className={`font-medium text-[13px] ${
              streamingActive ? "text-status-error" : "text-accent-9"
            }`}
          >
            {streamingActive ? "Stop" : "New"}
          </Text>
        </Pressable>
      )}
      <MessagesList
        messages={thread}
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
