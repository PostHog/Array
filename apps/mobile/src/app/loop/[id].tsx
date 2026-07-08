import { Text } from "@components/text";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { LoopDetail } from "@/features/loops/components/LoopDetail";
import { LoopForm } from "@/features/loops/components/LoopForm";
import {
  useDeleteLoop,
  useLoop,
  useRunLoop,
  useUpdateLoop,
} from "@/features/loops/hooks/useLoops";
import { useThemeColors } from "@/lib/theme";

export default function LoopDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const themeColors = useThemeColors();
  const { data: loop, isLoading, error } = useLoop(id);
  const updateLoop = useUpdateLoop();
  const deleteLoop = useDeleteLoop();
  const runLoop = useRunLoop();
  const [isEditing, setIsEditing] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  if (error || (!loop && !isLoading)) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTitle: "Loop",
            headerStyle: { backgroundColor: themeColors.background },
            headerTintColor: themeColors.gray[12],
            presentation: "modal",
          }}
        />
        <View className="flex-1 items-center justify-center bg-background px-4">
          <Text className="mb-4 text-center text-status-error">
            {error?.message ?? "Loop not found"}
          </Text>
          <Pressable
            onPress={() => router.back()}
            className="rounded-lg bg-gray-3 px-4 py-2"
          >
            <Text className="text-gray-12">Go back</Text>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: isEditing ? "Edit loop" : (loop?.name ?? "Loop"),
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
          className="flex-1 px-3 pt-4"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {isLoading || !loop ? (
            <View className="items-center pt-12">
              <ActivityIndicator size="large" color={themeColors.accent[9]} />
              <Text className="mt-4 text-gray-11">Loading loop...</Text>
            </View>
          ) : isEditing ? (
            <LoopForm
              loop={loop}
              isSubmitting={updateLoop.isPending}
              submitLabel="Save changes"
              generalError={generalError}
              onCancel={() => {
                setGeneralError(null);
                setIsEditing(false);
              }}
              onSubmit={async (values) => {
                setGeneralError(null);

                try {
                  await updateLoop.mutateAsync({
                    loopId: loop.id,
                    updates: values,
                  });
                  setIsEditing(false);
                } catch {
                  setGeneralError("Could not save loop changes.");
                }
              }}
            />
          ) : (
            <LoopDetail
              loop={loop}
              isWorking={runLoop.isPending || updateLoop.isPending}
              onEdit={() => setIsEditing(true)}
              onToggleEnabled={async () => {
                setGeneralError(null);
                try {
                  await updateLoop.mutateAsync({
                    loopId: loop.id,
                    updates: { enabled: !loop.enabled },
                  });
                } catch {
                  setGeneralError("Could not update the loop's state.");
                }
              }}
              onRunNow={async () => {
                setGeneralError(null);
                try {
                  const fire = await runLoop.mutateAsync(loop.id);
                  if (fire.task_id) {
                    router.push({
                      pathname: "/task/[id]",
                      params: { id: fire.task_id },
                    });
                  }
                } catch {
                  setGeneralError("Could not start the loop run.");
                }
              }}
              onDelete={() => {
                Alert.alert(
                  "Delete loop?",
                  "This will remove every trigger and stop future runs.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: async () => {
                        try {
                          await deleteLoop.mutateAsync(loop.id);
                          router.back();
                        } catch {
                          setGeneralError("Could not delete loop.");
                        }
                      },
                    },
                  ],
                );
              }}
            />
          )}

          {generalError && !isEditing && (
            <Text className="mt-4 text-sm text-status-error">
              {generalError}
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
