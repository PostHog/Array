import { Text } from "@components/text";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef } from "react";
import { InteractionManager, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MenuButton } from "@/features/navigation/components/MenuButton";
import { AutomationList } from "@/features/tasks/components/AutomationList";

export default function AutomationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const readyRef = useRef(true);

  useFocusEffect(
    useCallback(() => {
      const handle = InteractionManager.runAfterInteractions(() => {
        readyRef.current = true;
      });
      return () => {
        readyRef.current = false;
        handle.cancel();
      };
    }, []),
  );

  const handleCreateAutomation = useCallback(() => {
    if (!readyRef.current) return;
    readyRef.current = false;
    router.push("/automation");
  }, [router]);

  const handleAutomationPress = useCallback(
    (automationId: string) => {
      if (!readyRef.current) return;
      readyRef.current = false;
      router.push(`/automation/${automationId}`);
    },
    [router],
  );

  return (
    <View className="flex-1 bg-background">
      <View
        className="border-gray-6 border-b px-3 pb-4"
        style={{ paddingTop: insets.top + 12 }}
      >
        <View className="flex-row items-center gap-2">
          <MenuButton />
          <Text className="flex-1 font-semibold text-[16px] text-gray-12">
            Automations
          </Text>
          <Pressable
            onPress={handleCreateAutomation}
            className="rounded-md bg-accent-9 px-3.5 py-2 active:opacity-80"
          >
            <Text className="font-semibold text-[13px] text-accent-contrast">
              New automation
            </Text>
          </Pressable>
        </View>
      </View>

      <AutomationList
        onAutomationPress={handleAutomationPress}
        onCreateAutomation={handleCreateAutomation}
      />
    </View>
  );
}
