import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { useSignalSourceManager } from "@features/inbox/hooks/useSignalSourceManager";
import { useSlackChannels } from "@features/inbox/hooks/useSlackChannels";
import { useIntegrationSelectors } from "@features/integrations/stores/integrationStore";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Box, Button, Flex, Select, Text } from "@radix-ui/themes";
import type { SignalReportPriority } from "@shared/types";
import { openUrlInBrowser } from "@utils/browser";
import { getPostHogUrl } from "@utils/urls";

const NOTIFY_OFF_VALUE = "__off__";
const NOTIFY_ALL_VALUE = "__all__";

const MIN_PRIORITY_OPTIONS: {
  value: SignalReportPriority | typeof NOTIFY_ALL_VALUE;
  label: string;
}[] = [
  {
    value: NOTIFY_ALL_VALUE,
    label: "Every priority (including unprioritized)",
  },
  { value: "P0", label: "P0 only (critical)" },
  { value: "P1", label: "P1 and above" },
  { value: "P2", label: "P2 and above" },
  { value: "P3", label: "P3 and above" },
  { value: "P4", label: "P4 and above" },
];

function buildChannelTargetValue(
  channelId: string,
  channelName: string,
): string {
  // Mirror the convention used by the rest of PostHog: `channelId|#channel-name`.
  const display = channelName.startsWith("#") ? channelName : `#${channelName}`;
  return `${channelId}|${display}`;
}

function parseChannelIdFromTargetValue(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return value.split("|")[0]?.trim() || null;
}

export function SignalSlackNotificationsSettings() {
  const projectId = useAuthStateValue((s) => s.projectId);
  const cloudRegion = useAuthStateValue((s) => s.cloudRegion);
  const { slackIntegrations, hasSlackIntegration } = useIntegrationSelectors();
  const { userAutonomyConfig, handleUpdateSlackNotifications } =
    useSignalSourceManager();

  const selectedIntegrationId =
    userAutonomyConfig?.slack_notification_integration_id ?? null;
  const selectedChannelTarget =
    userAutonomyConfig?.slack_notification_channel ?? null;
  const selectedChannelId = parseChannelIdFromTargetValue(
    selectedChannelTarget,
  );
  const minPriority =
    userAutonomyConfig?.slack_notification_min_priority ?? null;

  // Default the integration selection to the first one if there's only one
  // available — we still require an explicit channel pick to enable delivery.
  const effectiveIntegrationId =
    selectedIntegrationId ??
    (slackIntegrations.length === 1 ? slackIntegrations[0].id : null);

  const { data: channelsData, isPending: channelsLoading } = useSlackChannels(
    effectiveIntegrationId,
  );

  const slackSettingsUrl = projectId
    ? getPostHogUrl(
        `/project/${projectId}/settings/project-integrations#slack`,
        cloudRegion,
      )
    : null;

  const notificationsEnabled =
    !!selectedIntegrationId && !!selectedChannelTarget;

  if (!hasSlackIntegration) {
    return (
      <Flex
        direction="column"
        gap="2"
        pt="4"
        style={{ borderTop: "1px dashed var(--gray-5)" }}
      >
        <Text className="font-medium text-(--gray-12) text-sm">
          Slack notifications for new inbox items
        </Text>
        <Text className="text-(--gray-11) text-[13px]">
          Get pinged in Slack when a new inbox item lands and you're a suggested
          reviewer. Connect Slack to PostHog first.
        </Text>
        <Box>
          <Button
            size="1"
            variant="soft"
            disabled={!slackSettingsUrl}
            onClick={() => {
              if (slackSettingsUrl) void openUrlInBrowser(slackSettingsUrl);
            }}
          >
            <ArrowSquareOutIcon size={12} />
            Connect Slack in PostHog
          </Button>
        </Box>
      </Flex>
    );
  }

  const onChannelChange = (value: string) => {
    if (value === NOTIFY_OFF_VALUE) {
      // Turn off by clearing the channel; integration ID is kept so re-enabling
      // remembers the previous workspace.
      void handleUpdateSlackNotifications({ channel: null });
      return;
    }
    if (!effectiveIntegrationId) return;
    const channel = channelsData?.channels?.find((c) => c.id === value);
    if (!channel) return;
    void handleUpdateSlackNotifications({
      integrationId: effectiveIntegrationId,
      channel: buildChannelTargetValue(channel.id, channel.name),
    });
  };

  const onIntegrationChange = (value: string) => {
    const integrationId = Number(value);
    if (!Number.isFinite(integrationId)) return;
    // Switching workspaces clears the channel — the previously picked
    // channel won't exist in the new workspace.
    void handleUpdateSlackNotifications({
      integrationId,
      channel: null,
    });
  };

  const onMinPriorityChange = (value: string) => {
    void handleUpdateSlackNotifications({
      minPriority: value === NOTIFY_ALL_VALUE ? null : value,
    });
  };

  return (
    <Flex
      direction="column"
      gap="3"
      pt="4"
      style={{ borderTop: "1px dashed var(--gray-5)" }}
    >
      <Text className="font-medium text-(--gray-12) text-sm">
        Slack notifications for new inbox items
      </Text>
      <Text className="text-(--gray-11) text-[13px]">
        When a new inbox item lands and you're a suggested reviewer, PostHog
        posts a Slack message in the channel you select. Pick a minimum priority
        to filter out lower-urgency reports.
      </Text>

      {slackIntegrations.length > 1 ? (
        <Flex direction="column" gap="1">
          <Text className="text-(--gray-11) text-[12px]">Slack workspace</Text>
          <Select.Root
            value={effectiveIntegrationId ? String(effectiveIntegrationId) : ""}
            onValueChange={onIntegrationChange}
          >
            <Select.Trigger
              className="max-w-[300px]"
              placeholder="Select a workspace"
            />
            <Select.Content>
              {slackIntegrations.map((integration) => {
                const label =
                  integration.display_name ??
                  integration.config?.account?.name ??
                  `Slack workspace ${integration.id}`;
                return (
                  <Select.Item
                    key={integration.id}
                    value={String(integration.id)}
                  >
                    {label}
                  </Select.Item>
                );
              })}
            </Select.Content>
          </Select.Root>
        </Flex>
      ) : null}

      <Flex direction="column" gap="1">
        <Text className="text-(--gray-11) text-[12px]">
          Notification channel
        </Text>
        <Select.Root
          value={
            notificationsEnabled && selectedChannelId
              ? selectedChannelId
              : NOTIFY_OFF_VALUE
          }
          disabled={!effectiveIntegrationId || channelsLoading}
          onValueChange={onChannelChange}
        >
          <Select.Trigger
            className="max-w-[300px]"
            placeholder={
              channelsLoading ? "Loading channels..." : "Pick a channel"
            }
          />
          <Select.Content>
            <Select.Item value={NOTIFY_OFF_VALUE}>
              Off — don't notify me
            </Select.Item>
            {(channelsData?.channels ?? [])
              .filter((c) => !c.is_private_without_access)
              .map((channel) => (
                <Select.Item key={channel.id} value={channel.id}>
                  {channel.is_private ? "🔒" : "#"}
                  {channel.name}
                  {channel.is_ext_shared ? "  (shared)" : ""}
                </Select.Item>
              ))}
          </Select.Content>
        </Select.Root>
        <Text className="text-(--gray-10) text-[12px]">
          PostHog needs to be a member of the channel to post. Invite it with{" "}
          <code>/invite @PostHog</code> in Slack if delivery fails.
        </Text>
      </Flex>

      <Flex direction="column" gap="1">
        <Text className="text-(--gray-11) text-[12px]">
          Minimum priority to notify
        </Text>
        <Select.Root
          value={minPriority ?? NOTIFY_ALL_VALUE}
          disabled={!notificationsEnabled}
          onValueChange={onMinPriorityChange}
        >
          <Select.Trigger className="max-w-[300px]" />
          <Select.Content>
            {MIN_PRIORITY_OPTIONS.map((opt) => (
              <Select.Item key={opt.value} value={opt.value}>
                {opt.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>
    </Flex>
  );
}
