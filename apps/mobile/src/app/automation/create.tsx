import { getCalendars } from "expo-localization";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { Text } from "@/components/text";
import { TaskAutomationValidationError } from "@/features/tasks/api";
import { AutomationForm } from "@/features/tasks/components/AutomationForm";
import { useCreateTaskAutomation } from "@/features/tasks/hooks/useAutomations";
import { useSkillStoreSkill } from "@/features/tasks/skills/hooks";
import { formatSkillTemplateId } from "@/features/tasks/skills/skillTemplateIds";
import { useThemeColors } from "@/lib/theme";

export default function CreateAutomationScreen() {
  const { skillName: skillNameParam } = useLocalSearchParams<{
    skillName?: string | string[];
  }>();
  const skillName = Array.isArray(skillNameParam)
    ? skillNameParam[0]
    : skillNameParam;
  const router = useRouter();
  const themeColors = useThemeColors();
  const createAutomation = useCreateTaskAutomation();
  const defaultTimezone = useMemo(
    () => getCalendars()[0]?.timeZone ?? "UTC",
    [],
  );
  const selectedSkill = useSkillStoreSkill(skillName ?? null);
  const selectedSkillName = selectedSkill.data?.name ?? skillName ?? null;
  const skillInitialValues = useMemo(
    () =>
      selectedSkill.data && selectedSkillName
        ? {
            name: selectedSkill.data.name,
            prompt: selectedSkill.data.body,
            enabled: true,
            template_id: formatSkillTemplateId(selectedSkillName),
          }
        : null,
    [selectedSkill.data, selectedSkillName],
  );
  const [fieldError, setFieldError] = useState<{
    attr: string | null;
    message: string | null;
  } | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: "Create automation",
          headerStyle: { backgroundColor: themeColors.background },
          headerTintColor: themeColors.gray[12],
          presentation: "modal",
        }}
      />
      <KeyboardAvoidingView
        className="flex-1 bg-background"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          className="flex-1 px-4 pt-4"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <View className="gap-4">
            {skillName && selectedSkill.isPending ? (
              <View className="items-center rounded-xl border border-gray-6 bg-gray-2 p-5">
                <ActivityIndicator size="small" color={themeColors.accent[9]} />
                <Text className="mt-3 text-gray-11 text-sm">
                  Loading the selected skill...
                </Text>
              </View>
            ) : skillName && (selectedSkill.error || !selectedSkill.data) ? (
              <View className="rounded-xl border border-gray-6 bg-gray-2 p-4">
                <Text className="font-semibold text-[15px] text-gray-12">
                  Could not load this skill
                </Text>
                <Text className="mt-2 text-gray-11 text-sm">
                  {selectedSkill.error?.message ??
                    "The selected skill is unavailable right now."}
                </Text>
                <View className="mt-4 flex-row gap-3">
                  <Pressable
                    onPress={() => void selectedSkill.refetch()}
                    className="flex-1 rounded-xl border border-gray-6 bg-gray-1 py-3"
                  >
                    <Text className="text-center font-medium text-gray-12">
                      Try again
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => router.replace("/automation/create")}
                    className="flex-1 rounded-xl border border-gray-6 bg-gray-1 py-3"
                  >
                    <Text className="text-center font-medium text-gray-12">
                      Start from scratch
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                {selectedSkillName && (
                  <View>
                    <Text className="text-[11px] text-gray-9 uppercase">
                      Skill
                    </Text>
                    <Text className="mt-1 font-semibold text-[16px] text-gray-12">
                      {selectedSkillName}
                    </Text>
                  </View>
                )}

                <AutomationForm
                  initialValues={{
                    name: skillInitialValues?.name,
                    prompt: skillInitialValues?.prompt,
                    timezone: defaultTimezone,
                    enabled: skillInitialValues?.enabled ?? true,
                  }}
                  initialPromptMode={selectedSkillName ? "preview" : "edit"}
                  isSubmitting={createAutomation.isPending}
                  submitLabel="Create automation"
                  fieldError={fieldError}
                  generalError={generalError}
                  onSubmit={async (values) => {
                    setFieldError(null);
                    setGeneralError(null);

                    try {
                      const automation = await createAutomation.mutateAsync({
                        ...values,
                        template_id: skillInitialValues?.template_id ?? null,
                      });
                      router.replace(`/automation/${automation.id}`);
                    } catch (error) {
                      if (error instanceof TaskAutomationValidationError) {
                        setFieldError({
                          attr: error.attr,
                          message: error.message,
                        });
                        return;
                      }

                      setGeneralError(
                        "Could not create automation. Please try again.",
                      );
                    }
                  }}
                  onCancel={() => router.back()}
                />
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
