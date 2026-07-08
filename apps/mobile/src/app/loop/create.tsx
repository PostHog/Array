import { Stack, useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { Text } from "@/components/text";
import { LoopForm } from "@/features/loops/components/LoopForm";
import { useCreateLoop } from "@/features/loops/hooks/useLoops";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { useThemeColors } from "@/lib/theme";

const FLOATING_BUTTON_AREA_HEIGHT = 64;
const FLOATING_BUTTON_DEAD_SPACE = 32;

export default function CreateLoopScreen() {
  const router = useRouter();
  const themeColors = useThemeColors();
  const { insets, bottom } = useScreenInsets();
  const createLoop = useCreateLoop();
  const [generalError, setGeneralError] = useState<string | null>(null);

  const submitRef = useRef<(() => void) | null>(null);
  const [canSubmit, setCanSubmit] = useState(false);
  const isSubmitting = createLoop.isPending;

  const scrollPaddingBottom =
    FLOATING_BUTTON_AREA_HEIGHT + insets.bottom + FLOATING_BUTTON_DEAD_SPACE;

  const handleCreate = () => submitRef.current?.();

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: "Create loop",
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
          contentContainerStyle={{ paddingBottom: scrollPaddingBottom }}
        >
          <LoopForm
            isSubmitting={isSubmitting}
            submitLabel="Create"
            generalError={generalError}
            hideFooter
            submitRef={submitRef}
            onCanSubmitChange={setCanSubmit}
            onSubmit={async (values) => {
              setGeneralError(null);

              try {
                const loop = await createLoop.mutateAsync(values);
                router.replace(`/loop/${loop.id}`);
              } catch {
                setGeneralError("Could not create loop. Please try again.");
              }
            }}
          />
        </ScrollView>

        <View
          className="absolute inset-x-0 bottom-0 border-gray-6 border-t bg-background px-4 pt-3"
          style={{ paddingBottom: bottom("compact") }}
        >
          <Pressable
            onPress={handleCreate}
            disabled={!canSubmit || isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="Create loop"
            className={`rounded-xl py-3.5 ${
              canSubmit && !isSubmitting ? "bg-accent-9" : "bg-gray-3"
            }`}
          >
            {isSubmitting ? (
              <ActivityIndicator
                size="small"
                color={themeColors.accent.contrast}
              />
            ) : (
              <Text
                className={`text-center font-semibold text-[15px] ${
                  canSubmit ? "text-accent-contrast" : "text-gray-9"
                }`}
              >
                Create
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}
