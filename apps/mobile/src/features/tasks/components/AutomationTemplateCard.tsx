import { Pressable, View } from "react-native";
import { Text } from "@/components/text";
import type { AutomationTemplate } from "../types";

interface AutomationTemplateCardProps {
  template: AutomationTemplate;
  onPress: (templateId: string) => void;
}

export function AutomationTemplateCard({
  template,
  onPress,
}: AutomationTemplateCardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress(template.id)}
      className={`rounded-xl border px-4 py-4 active:opacity-80 ${
        template.hero
          ? "border-accent-6 bg-accent-2"
          : "border-gray-6 bg-gray-1"
      }`}
    >
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="rounded-full bg-gray-3 px-2 py-1 font-medium text-[11px] text-gray-11">
          {template.audienceLabel}
        </Text>
        <Text className="rounded-full bg-gray-3 px-2 py-1 font-medium text-[11px] text-gray-11">
          {template.categoryLabel}
        </Text>
        {template.hero && (
          <Text className="rounded-full bg-accent-9 px-2 py-1 font-medium text-[11px] text-accent-contrast">
            Recommended
          </Text>
        )}
      </View>

      <Text className="mt-3 font-semibold text-[16px] text-gray-12">
        {template.name}
      </Text>
      <Text className="mt-2 text-gray-11 text-sm">{template.description}</Text>

      <Text className="mt-3 text-gray-9 text-xs">
        {template.requiresRepository
          ? "Requires repository access"
          : "No repository required"}
      </Text>
    </Pressable>
  );
}
