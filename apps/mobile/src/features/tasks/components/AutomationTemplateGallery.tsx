import { Pressable, View } from "react-native";
import { Text } from "@/components/text";
import {
  AUTOMATION_TEMPLATES,
  getAutomationTemplates,
} from "../templates/automationTemplates";
import type { AutomationTemplate } from "../types";
import { AutomationTemplateCard } from "./AutomationTemplateCard";

interface AutomationTemplateGalleryProps {
  templates?: ReadonlyArray<AutomationTemplate>;
  onSelectTemplate: (templateId: string) => void;
  onCreateCustom: () => void;
}

export function AutomationTemplateGallery({
  templates = AUTOMATION_TEMPLATES,
  onSelectTemplate,
  onCreateCustom,
}: AutomationTemplateGalleryProps) {
  const launchTemplates =
    templates.length > 0 ? templates : getAutomationTemplates();

  return (
    <View className="gap-4">
      <View>
        <Text className="font-semibold text-[14px] text-gray-12">
          Launch templates
        </Text>
        <Text className="mt-1 text-gray-10 text-sm">
          Choose a starter workflow and tweak it before saving.
        </Text>
      </View>

      {launchTemplates.map((template) => (
        <AutomationTemplateCard
          key={template.id}
          template={template}
          onPress={onSelectTemplate}
        />
      ))}

      <Pressable
        accessibilityRole="button"
        onPress={onCreateCustom}
        className="rounded-xl border border-gray-6 border-dashed bg-gray-1 px-4 py-4 active:opacity-80"
      >
        <Text className="font-semibold text-[15px] text-gray-12">
          Start from scratch
        </Text>
        <Text className="mt-2 text-gray-10 text-sm">
          Create a custom automation without using one of the launch templates.
        </Text>
      </Pressable>
    </View>
  );
}
