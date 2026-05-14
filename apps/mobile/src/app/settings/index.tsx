import { Text } from "@components/text";
import { router } from "expo-router";
import { ArrowSquareOut, CaretRight, SpeakerHigh } from "phosphor-react-native";
import { useState } from "react";
import { Linking, Pressable, ScrollView, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthStore, useUserQuery } from "@/features/auth";
import { useDismissedReportsStore } from "@/features/inbox/stores/dismissedReportsStore";
import { usePushTokenStore } from "@/features/notifications/stores/pushTokenStore";
import {
  type CompletionSound,
  type InitialTaskMode,
  type ThemePreference,
  usePreferencesStore,
} from "@/features/preferences/stores/preferencesStore";
import { FloatingSettingsHeader } from "@/features/settings/components/FloatingSettingsHeader";
import { SettingsRow } from "@/features/settings/components/SettingsRow";
import { SettingsSection } from "@/features/settings/components/SettingsSection";
import { SelectSheet } from "@/features/tasks/composer/SelectSheet";
import { playCompletionSound } from "@/features/tasks/utils/sounds";
import { logger } from "@/lib/logger";
import { useThemeColors } from "@/lib/theme";

const THEME_OPTIONS = [
  { value: "system", label: "Match system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const SOUND_OPTIONS: ReadonlyArray<{ value: CompletionSound; label: string }> =
  [
    { value: "meep", label: "Meep" },
    { value: "knock", label: "Knock" },
    { value: "ring", label: "Ring" },
    { value: "shoot", label: "Shoot" },
    { value: "slide", label: "Slide" },
    { value: "drop", label: "Drop" },
  ];

const VOLUME_OPTIONS = [
  { value: "25", label: "Quiet (25%)" },
  { value: "50", label: "Normal (50%)" },
  { value: "75", label: "Loud (75%)" },
  { value: "100", label: "Max (100%)" },
] as const;

const TASK_MODE_OPTIONS = [
  {
    value: "plan",
    label: "Plan",
    description: "New tasks always start in Plan mode",
  },
  {
    value: "last_used",
    label: "Last used",
    description: "Remember the mode you picked last time",
  },
] as const;

function themeLabel(theme: ThemePreference): string {
  return THEME_OPTIONS.find((o) => o.value === theme)?.label ?? "Match system";
}

function soundLabel(sound: CompletionSound): string {
  return SOUND_OPTIONS.find((o) => o.value === sound)?.label ?? "Meep";
}

function volumeLabel(volume: number): string {
  if (volume >= 100) return "Max";
  if (volume >= 75) return "Loud";
  if (volume >= 50) return "Normal";
  return "Quiet";
}

function taskModeLabel(mode: InitialTaskMode): string {
  return TASK_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? "Plan";
}

export default function SettingsScreen() {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();

  const { logout, cloudRegion, getCloudUrlFromRegion } = useAuthStore();
  const { data: userData } = useUserQuery();

  const aiChatEnabled = usePreferencesStore((s) => s.aiChatEnabled);
  const setAiChatEnabled = usePreferencesStore((s) => s.setAiChatEnabled);
  const pingsEnabled = usePreferencesStore((s) => s.pingsEnabled);
  const setPingsEnabled = usePreferencesStore((s) => s.setPingsEnabled);
  const pushNotificationsEnabled = usePreferencesStore(
    (s) => s.pushNotificationsEnabled,
  );
  const setPushNotificationsEnabled = usePreferencesStore(
    (s) => s.setPushNotificationsEnabled,
  );
  const theme = usePreferencesStore((s) => s.theme);
  const setTheme = usePreferencesStore((s) => s.setTheme);
  const completionSound = usePreferencesStore((s) => s.completionSound);
  const setCompletionSound = usePreferencesStore((s) => s.setCompletionSound);
  const completionVolume = usePreferencesStore((s) => s.completionVolume);
  const setCompletionVolume = usePreferencesStore((s) => s.setCompletionVolume);
  const defaultInitialTaskMode = usePreferencesStore(
    (s) => s.defaultInitialTaskMode,
  );
  const setDefaultInitialTaskMode = usePreferencesStore(
    (s) => s.setDefaultInitialTaskMode,
  );
  const dismissedCount = useDismissedReportsStore((s) => s.dismissedIds.length);
  const clearDismissed = useDismissedReportsStore((s) => s.clearDismissed);

  const [themeSheetOpen, setThemeSheetOpen] = useState(false);
  const [soundSheetOpen, setSoundSheetOpen] = useState(false);
  const [volumeSheetOpen, setVolumeSheetOpen] = useState(false);
  const [taskModeSheetOpen, setTaskModeSheetOpen] = useState(false);

  const handleTogglePushNotifications = (enabled: boolean) => {
    setPushNotificationsEnabled(enabled);
    if (enabled) {
      usePushTokenStore
        .getState()
        .registerAndUpload()
        .catch((error) => {
          logger.warn("Push token registration failed", error);
        });
    } else {
      usePushTokenStore
        .getState()
        .clear()
        .catch((error) => {
          logger.warn("Push token clear failed", error);
        });
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/auth");
  };

  const handleOpenWebSettings = () => {
    if (!cloudRegion) return;
    const baseUrl = getCloudUrlFromRegion(cloudRegion);
    Linking.openURL(`${baseUrl}/settings`).catch(() => {});
  };

  const handleTestSound = () => {
    playCompletionSound().catch(() => {});
  };

  // Top padding leaves room for the floating header (insets.top + ~52). Bottom
  // padding clears the home indicator and gives breathing room past the last
  // row so it never hides behind it.
  const contentPaddingTop = insets.top + 60;
  const contentPaddingBottom = insets.bottom + 32;

  return (
    <View className="flex-1 bg-background">
      <FloatingSettingsHeader />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: contentPaddingTop,
          paddingBottom: contentPaddingBottom,
          paddingHorizontal: 16,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Appearance */}
        <SettingsSection title="Appearance">
          <SettingsRow
            label="Theme"
            description="Choose light, dark, or follow your system preference"
            onPress={() => setThemeSheetOpen(true)}
            showDivider={false}
            rightSlot={
              <>
                <Text className="text-[14px] text-gray-11">
                  {themeLabel(theme)}
                </Text>
                <CaretRight size={14} color={themeColors.gray[10]} />
              </>
            }
          />
        </SettingsSection>

        {/* Notifications */}
        <SettingsSection title="Notifications">
          <SettingsRow
            label="Push notifications"
            description="Get notified when a task finishes or needs your input"
            rightSlot={
              <Switch
                value={pushNotificationsEnabled}
                onValueChange={handleTogglePushNotifications}
              />
            }
          />
          <SettingsRow
            label="Enable pings"
            description="Play a sound when a task completes"
            showDivider={false}
            rightSlot={
              <Switch value={pingsEnabled} onValueChange={setPingsEnabled} />
            }
          />
        </SettingsSection>

        {/* Sound */}
        {pingsEnabled ? (
          <SettingsSection title="Sound">
            <SettingsRow
              label="Completion sound"
              description="Pick the sound that plays when a task completes"
              onPress={() => setSoundSheetOpen(true)}
              rightSlot={
                <>
                  <Pressable
                    onPress={handleTestSound}
                    hitSlop={8}
                    className="rounded-md bg-gray-3 px-2 py-1 active:opacity-60"
                  >
                    <SpeakerHigh size={14} color={themeColors.gray[12]} />
                  </Pressable>
                  <Text className="text-[14px] text-gray-11">
                    {soundLabel(completionSound)}
                  </Text>
                  <CaretRight size={14} color={themeColors.gray[10]} />
                </>
              }
            />
            <SettingsRow
              label="Sound volume"
              description="How loud the completion sound plays"
              onPress={() => setVolumeSheetOpen(true)}
              showDivider={false}
              rightSlot={
                <>
                  <Text className="text-[14px] text-gray-11">
                    {volumeLabel(completionVolume)} ({completionVolume}%)
                  </Text>
                  <CaretRight size={14} color={themeColors.gray[10]} />
                </>
              }
            />
          </SettingsSection>
        ) : null}

        {/* Input */}
        <SettingsSection title="Input">
          <SettingsRow
            label="Initial task mode"
            description="What mode new tasks start in"
            onPress={() => setTaskModeSheetOpen(true)}
            showDivider={false}
            rightSlot={
              <>
                <Text className="text-[14px] text-gray-11">
                  {taskModeLabel(defaultInitialTaskMode)}
                </Text>
                <CaretRight size={14} color={themeColors.gray[10]} />
              </>
            }
          />
        </SettingsSection>

        {/* Labs */}
        <SettingsSection
          title="Labs"
          description="Experimental features — may break, may change"
        >
          <SettingsRow
            label="PostHog AI chat"
            description="Show the Chats tab for PostHog AI conversations"
            showDivider={false}
            rightSlot={
              <Switch value={aiChatEnabled} onValueChange={setAiChatEnabled} />
            }
          />
        </SettingsSection>

        {/* Inbox */}
        <SettingsSection title="Inbox">
          <SettingsRow
            label="Dismissed reports"
            description={`${dismissedCount} report${dismissedCount === 1 ? "" : "s"} dismissed in review mode`}
            showDivider={false}
            rightSlot={
              <Pressable
                onPress={clearDismissed}
                disabled={dismissedCount === 0}
                hitSlop={6}
                className={`rounded-md border px-3 py-1.5 ${dismissedCount > 0 ? "border-gray-6 bg-gray-3 active:opacity-60" : "border-gray-4 opacity-40"}`}
              >
                <Text className="font-medium text-[13px] text-gray-12">
                  Clear
                </Text>
              </Pressable>
            }
          />
        </SettingsSection>

        {/* Organization */}
        <SettingsSection title="Organization">
          <SettingsRow
            label="Region"
            rightSlot={
              <Text className="font-medium text-[14px] text-gray-12">
                {cloudRegion?.toUpperCase() || "—"}
              </Text>
            }
          />
          <SettingsRow
            label="Display name"
            showDivider={false}
            rightSlot={
              <Text
                className="max-w-[180px] text-right font-medium text-[14px] text-gray-12"
                numberOfLines={1}
              >
                {userData?.organization?.name || "—"}
              </Text>
            }
          />
        </SettingsSection>

        {/* Project */}
        <SettingsSection title="Project">
          <SettingsRow
            label="Display name"
            showDivider={false}
            rightSlot={
              <Text
                className="max-w-[180px] text-right font-medium text-[14px] text-gray-12"
                numberOfLines={1}
              >
                {userData?.team?.name || "—"}
              </Text>
            }
          />
        </SettingsSection>

        {/* Profile */}
        <SettingsSection title="Profile">
          <SettingsRow
            label="First name"
            rightSlot={
              <Text
                className="max-w-[180px] text-right font-medium text-[14px] text-gray-12"
                numberOfLines={1}
              >
                {userData?.first_name || "—"}
              </Text>
            }
          />
          <SettingsRow
            label="Last name"
            rightSlot={
              <Text
                className="max-w-[180px] text-right font-medium text-[14px] text-gray-12"
                numberOfLines={1}
              >
                {userData?.last_name || "—"}
              </Text>
            }
          />
          <SettingsRow
            label="Email"
            showDivider={false}
            rightSlot={
              <Text
                className="max-w-[220px] text-right font-medium text-[14px] text-gray-12"
                numberOfLines={1}
              >
                {userData?.email || "—"}
              </Text>
            }
          />
        </SettingsSection>

        {/* Account */}
        <SettingsSection title="Account">
          <SettingsRow
            label="All PostHog settings"
            description="Open your full settings on the PostHog website"
            onPress={handleOpenWebSettings}
            disabled={!cloudRegion}
            rightSlot={
              <ArrowSquareOut size={16} color={themeColors.gray[11]} />
            }
          />
          <SettingsRow
            label="Sign out"
            description="Sign out of this device"
            onPress={handleLogout}
            showDivider={false}
            rightSlot={
              <Text className="font-medium text-[14px] text-status-error">
                Sign out
              </Text>
            }
          />
        </SettingsSection>
      </ScrollView>

      <SelectSheet
        open={themeSheetOpen}
        title="Theme"
        value={theme}
        onChange={(value) => setTheme(value as ThemePreference)}
        onClose={() => setThemeSheetOpen(false)}
        options={THEME_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
      />

      <SelectSheet
        open={soundSheetOpen}
        title="Completion sound"
        value={completionSound}
        onChange={(value) => {
          const next = value as CompletionSound;
          setCompletionSound(next);
          playCompletionSound(next).catch(() => {});
        }}
        onClose={() => setSoundSheetOpen(false)}
        options={SOUND_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
      />

      <SelectSheet
        open={volumeSheetOpen}
        title="Sound volume"
        value={String(completionVolume) as "25" | "50" | "75" | "100"}
        onChange={(value) => {
          const next = parseInt(value, 10);
          setCompletionVolume(next);
          playCompletionSound(undefined, next).catch(() => {});
        }}
        onClose={() => setVolumeSheetOpen(false)}
        options={VOLUME_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
      />

      <SelectSheet
        open={taskModeSheetOpen}
        title="Initial task mode"
        value={defaultInitialTaskMode}
        onChange={(value) =>
          setDefaultInitialTaskMode(value as InitialTaskMode)
        }
        onClose={() => setTaskModeSheetOpen(false)}
        options={TASK_MODE_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
          description: option.description,
        }))}
      />
    </View>
  );
}
