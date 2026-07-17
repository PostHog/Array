import { ANALYTICS_EVENTS, PROJECT_BLUEBIRD_FLAG } from "@posthog/shared";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { useIntegrationSelectors } from "@posthog/ui/features/integrations/store";
import {
  useCodeUserNotificationSettings,
  useCodeUserNotificationSettingsMutations,
} from "@posthog/ui/features/settings/sections/useCodeUserNotificationSettings";
import { track } from "@posthog/ui/shell/analytics";
import { Flex, Switch, Text } from "@radix-ui/themes";

/**
 * Opt-in Slack DMs for channel-thread @-mentions. The preference lives on the
 * PostHog backend (per user, across projects); delivery uses the team's Slack
 * integration, so the section only shows once a workspace is connected.
 */
export function SlackMentionNotificationsSettings() {
  // Channel threads (and their @-mentions) only exist behind the bluebird flag.
  const channelsEnabled = useFeatureFlag(
    PROJECT_BLUEBIRD_FLAG,
    import.meta.env.DEV,
  );
  const { hasSlackIntegration } = useIntegrationSelectors();
  const { data: settings, isLoading } = useCodeUserNotificationSettings();
  const { handleUpdateSlackMentionNotifications } =
    useCodeUserNotificationSettingsMutations();

  // The connect-workspace prompt is the parent section's job.
  if (!channelsEnabled || !hasSlackIntegration) return null;

  const enabled = settings?.slack_mention_notifications ?? false;

  const onCheckedChange = (checked: boolean) => {
    track(ANALYTICS_EVENTS.SETTING_CHANGED, {
      setting_name: "slack_mention_notifications",
      new_value: checked,
      old_value: enabled,
    });
    void handleUpdateSlackMentionNotifications(checked);
  };

  return (
    <Flex
      direction="column"
      gap="2"
      className="border-(--gray-5) border-t border-dashed pt-4"
    >
      <Flex align="center" justify="between" gap="3">
        <Flex direction="column" gap="1">
          <Text className="font-medium text-(--gray-12) text-sm">
            Mention notifications
          </Text>
          <Text className="text-(--gray-11) text-[13px]">
            Get a Slack DM when someone @-mentions you in a channel thread.
          </Text>
        </Flex>
        <Switch
          checked={enabled}
          disabled={isLoading}
          onCheckedChange={onCheckedChange}
          aria-label="Slack DM on @-mention"
        />
      </Flex>
    </Flex>
  );
}
