import { Stack, useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { Text } from "@/components/text";
import { AutomationTemplateGallery } from "@/features/tasks/components/AutomationTemplateGallery";
import { useThemeColors } from "@/lib/theme";

export default function AutomationTemplateScreen() {
  const router = useRouter();
  const themeColors = useThemeColors();

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: "Choose a template",
          headerStyle: { backgroundColor: themeColors.background },
          headerTintColor: themeColors.gray[12],
          presentation: "modal",
        }}
      />
      <ScrollView
        className="flex-1 bg-background px-4 pt-4"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View className="gap-4">
          <View className="rounded-xl bg-gray-2 px-4 py-4">
            <Text className="font-semibold text-[16px] text-gray-12">
              Start with a template
            </Text>
            <Text className="mt-2 text-gray-11 text-sm">
              Pick a daily briefing template, tweak the prompt and schedule,
              then save it as an automation.
            </Text>
          </View>

          <AutomationTemplateGallery
            onSelectTemplate={(templateId) =>
              router.push({
                pathname: "/automation/create",
                params: { templateId },
              })
            }
            onCreateCustom={() => router.push("/automation/create")}
          />
        </View>
      </ScrollView>
    </>
  );
}
