import { useIsOrgAdmin } from "@features/auth/hooks/useOrgRole";
import { useSignalSourceManager } from "@features/inbox/hooks/useSignalSourceManager";
import { useIntegrationSelectors } from "@features/integrations/stores/integrationStore";
import { SlackChannelCombobox } from "@features/settings/components/SlackChannelCombobox";
import { Box, Flex, Text } from "@radix-ui/themes";

interface SignalDefaultChannelSettingsProps {
  channelComboboxModal?: boolean;
  isLoading?: boolean;
}

export function SignalDefaultChannelSettings({
  channelComboboxModal = false,
  isLoading = false,
}: SignalDefaultChannelSettingsProps) {
  const { slackIntegrations, hasSlackIntegration } = useIntegrationSelectors();
  const { teamConfig, handleUpdateTeamSlackChannel } = useSignalSourceManager();
  const { isAdmin } = useIsOrgAdmin();

  // The backend resolves the team's Slack integration dynamically (its first
  // `slack` install), so we list channels from that same workspace.
  const teamIntegrationId = slackIntegrations[0]?.id ?? null;
  const channelTarget = teamConfig?.default_slack_notification_channel ?? null;
  const canEdit = isAdmin === true;

  if (isLoading) {
    return (
      <Flex
        direction="column"
        gap="2"
        pt="3"
        className="border-(--gray-5) border-t border-dashed"
      >
        <Flex direction="column" gap="1">
          <Box className="h-[14px] w-[200px] animate-pulse rounded bg-gray-4" />
          <Box className="h-[11px] w-[80%] animate-pulse rounded bg-gray-3" />
        </Flex>
        <Box className="mt-1 h-[28px] w-[200px] animate-pulse rounded bg-gray-3" />
      </Flex>
    );
  }

  // Connecting Slack is offered in the per-user section below; nothing to
  // configure here until a workspace exists.
  if (!hasSlackIntegration) return null;

  return (
    <Flex
      direction="column"
      gap="2"
      pt="3"
      style={{ borderTop: "1px dashed var(--gray-5)" }}
    >
      <Flex direction="column" gap="1">
        <Text className="font-medium text-(--gray-12) text-sm">
          Default notification channel
        </Text>
        <Text className="text-(--gray-11) text-[13px]">
          Every new inbox report for the team is posted to this channel, with
          the suggested reviewers @mentioned. Shared across the whole team.
        </Text>
      </Flex>

      <Flex direction="column" gap="1" className="min-w-0">
        <Text className="text-(--gray-11) text-[12px]">Channel</Text>
        <SlackChannelCombobox
          integrationId={teamIntegrationId}
          value={channelTarget}
          onChange={(channel) => void handleUpdateTeamSlackChannel(channel)}
          offLabel="No default channel"
          ariaLabel="Default notification channel"
          modal={channelComboboxModal}
          disabled={!canEdit || !teamIntegrationId}
        />
      </Flex>

      <Text className="text-(--gray-10) text-[11px]">
        {isAdmin === false
          ? "Only organization admins can change the team's default channel."
          : "PostHog must be in the channel — invite with /invite @PostHog."}
      </Text>
    </Flex>
  );
}
