import { useSignalSourceManager } from "@features/inbox/hooks/useSignalSourceManager";
import { useIntegrationSelectors } from "@features/integrations/stores/integrationStore";
import { SettingsOptionSelect } from "@features/settings/components/SettingsOptionSelect";
import { SignalDefaultChannelSettings } from "@features/settings/components/sections/SignalDefaultChannelSettings";
import { SignalSlackNotificationsSettings } from "@features/settings/components/sections/SignalSlackNotificationsSettings";
import { SlackLogoIcon } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useMemo } from "react";

const WORKSPACE_CONTROL_CLASS = "min-w-[160px] max-w-[240px]";

function getSlackIntegrationLabel(integration: {
  id: number;
  display_name?: string;
  config?: { account?: { name?: string } };
}): string {
  return (
    integration.display_name ??
    integration.config?.account?.name ??
    `Slack workspace ${integration.id}`
  );
}

interface SlackInboxNotificationsSettingsProps {
  channelComboboxModal?: boolean;
  isLoading?: boolean;
}

export function SlackInboxNotificationsSettings({
  channelComboboxModal = false,
  isLoading = false,
}: SlackInboxNotificationsSettingsProps) {
  const { slackIntegrations, hasSlackIntegration } = useIntegrationSelectors();
  const { userAutonomyConfig, handleUpdateSlackNotifications } =
    useSignalSourceManager();

  // Workspace is shared by both the team default and the per-user channel. We
  // default to the only workspace when there's a single one; otherwise the user
  // picks (which also persists their personal notification integration).
  const selectedIntegrationId =
    userAutonomyConfig?.slack_notification_integration_id ?? null;
  const effectiveIntegrationId =
    selectedIntegrationId ??
    (slackIntegrations.length === 1 ? slackIntegrations[0].id : null);

  const integrationOptions = useMemo(
    () =>
      slackIntegrations.map((integration) => ({
        value: String(integration.id),
        label: getSlackIntegrationLabel(integration),
      })),
    [slackIntegrations],
  );

  const onIntegrationChange = (value: string) => {
    const integrationId = Number(value);
    if (!Number.isFinite(integrationId)) return;
    // Switching workspaces clears the personal channel — the previously picked
    // channel won't exist in the new workspace.
    void handleUpdateSlackNotifications({ integrationId, channel: null });
  };

  return (
    <Flex
      direction="column"
      gap="1"
      pt="3"
      style={{ borderTop: "1px dashed var(--gray-5)" }}
    >
      <Flex align="center" gap="2">
        <Box className="shrink-0 text-(--gray-11)">
          <SlackLogoIcon size={16} />
        </Box>
        <Text className="font-medium text-(--gray-12) text-sm">
          Inbox notifications
        </Text>
      </Flex>
      <Text className="text-(--gray-11) text-[13px]">
        New inbox reports are posted to Slack with the suggested reviewers
        @mentioned. PostHog must be in the channel, so invite it with{" "}
        <code className="text-[13px]">/invite @PostHog</code>.
      </Text>

      {!isLoading && hasSlackIntegration ? (
        <Flex align="center" gap="2" pt="2" className="min-w-0">
          <Text className="shrink-0 text-(--gray-11) text-[12px]">
            Workspace
          </Text>
          {slackIntegrations.length > 1 ? (
            <SettingsOptionSelect
              value={
                effectiveIntegrationId ? String(effectiveIntegrationId) : ""
              }
              options={integrationOptions}
              ariaLabel="Slack workspace"
              placeholder="Select workspace"
              className={WORKSPACE_CONTROL_CLASS}
              onValueChange={onIntegrationChange}
            />
          ) : slackIntegrations[0] ? (
            <Text className="truncate font-medium text-(--gray-12) text-[13px]">
              {getSlackIntegrationLabel(slackIntegrations[0])}
            </Text>
          ) : null}
        </Flex>
      ) : null}

      <SignalDefaultChannelSettings
        integrationId={effectiveIntegrationId}
        channelComboboxModal={channelComboboxModal}
        isLoading={isLoading}
      />
      <SignalSlackNotificationsSettings
        integrationId={effectiveIntegrationId}
        channelComboboxModal={channelComboboxModal}
        isLoading={isLoading}
      />
    </Flex>
  );
}
