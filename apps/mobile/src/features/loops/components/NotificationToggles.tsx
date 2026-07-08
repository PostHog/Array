import { Text } from "@components/text";
import { Pressable, Switch, TextInput, View } from "react-native";
import { useThemeColors } from "@/lib/theme";
import type {
  LoopNotificationChannel,
  LoopNotificationEvent,
  LoopNotifications,
} from "../types";

interface NotificationTogglesProps {
  notifications: LoopNotifications;
  onChange: (notifications: LoopNotifications) => void;
}

const EVENT_OPTIONS: Array<{ value: LoopNotificationEvent; label: string }> = [
  { value: "run_completed", label: "Run completed" },
  { value: "run_failed", label: "Run failed" },
  { value: "pr_created", label: "PR created" },
  { value: "needs_attention", label: "Needs attention" },
];

interface NotificationChannelSectionProps {
  title: string;
  channel: LoopNotificationChannel;
  onChange: (channel: LoopNotificationChannel) => void;
  slackParams?: boolean;
}

function NotificationChannelSection({
  title,
  channel,
  onChange,
  slackParams = false,
}: NotificationChannelSectionProps) {
  const themeColors = useThemeColors();

  const toggleEvent = (event: LoopNotificationEvent) => {
    const has = channel.events.includes(event);
    onChange({
      ...channel,
      events: has
        ? channel.events.filter((existing) => existing !== event)
        : [...channel.events, event],
    });
  };

  const slackIntegrationId =
    typeof channel.params.integration_id === "string"
      ? channel.params.integration_id
      : "";
  const slackChannel =
    typeof channel.params.channel === "string" ? channel.params.channel : "";

  return (
    <View className="gap-3 rounded-xl bg-gray-2 p-4">
      <View className="flex-row items-center justify-between">
        <Text className="font-semibold text-[15px] text-gray-12">{title}</Text>
        <Switch
          value={channel.enabled}
          onValueChange={(enabled) => onChange({ ...channel, enabled })}
        />
      </View>

      {channel.enabled && (
        <>
          <View className="flex-row flex-wrap gap-2">
            {EVENT_OPTIONS.map((option) => {
              const isSelected = channel.events.includes(option.value);
              return (
                <Pressable
                  key={option.value}
                  onPress={() => toggleEvent(option.value)}
                  className={`rounded-xl border px-3 py-2 ${
                    isSelected
                      ? "border-accent-8 bg-accent-3"
                      : "border-gray-5 bg-background"
                  }`}
                >
                  <Text
                    className={`text-sm ${
                      isSelected ? "text-accent-11" : "text-gray-11"
                    }`}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {slackParams && (
            <View className="gap-2">
              <TextInput
                className="rounded-xl border border-gray-5 bg-background px-3.5 py-3 text-[15px] text-gray-12"
                placeholder="Slack integration ID"
                placeholderTextColor={themeColors.gray[9]}
                value={slackIntegrationId}
                onChangeText={(value) =>
                  onChange({
                    ...channel,
                    params: { ...channel.params, integration_id: value },
                  })
                }
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                className="rounded-xl border border-gray-5 bg-background px-3.5 py-3 text-[15px] text-gray-12"
                placeholder="#channel"
                placeholderTextColor={themeColors.gray[9]}
                value={slackChannel}
                onChangeText={(value) =>
                  onChange({
                    ...channel,
                    params: { ...channel.params, channel: value },
                  })
                }
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          )}
        </>
      )}
    </View>
  );
}

export function NotificationToggles({
  notifications,
  onChange,
}: NotificationTogglesProps) {
  return (
    <View className="gap-3">
      <NotificationChannelSection
        title="Push"
        channel={notifications.push}
        onChange={(push) => onChange({ ...notifications, push })}
      />
      <NotificationChannelSection
        title="Email"
        channel={notifications.email}
        onChange={(email) => onChange({ ...notifications, email })}
      />
      <NotificationChannelSection
        title="Slack"
        channel={notifications.slack}
        onChange={(slack) => onChange({ ...notifications, slack })}
        slackParams
      />
    </View>
  );
}
