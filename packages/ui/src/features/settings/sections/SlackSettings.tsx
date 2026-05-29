import { ArrowSquareOutIcon, SlackLogoIcon } from "@phosphor-icons/react";
import { formatRelativeTimeLong } from "@posthog/shared";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import {
  type Integration,
  useIntegrationSelectors,
} from "@posthog/ui/features/integrations/store";
import { useIntegrations } from "@posthog/ui/features/integrations/useIntegrations";
import { openUrlInBrowser } from "@posthog/ui/utils/browser";
import { getPostHogUrl } from "@posthog/ui/utils/urls";
import { Box, Button, Flex, Spinner, Text, Tooltip } from "@radix-ui/themes";
import { SlackInboxNotificationsSettings } from "./SlackInboxNotificationsSettings";

export function SlackSettings() {
  const projectId = useAuthStateValue((s) => s.currentProjectId);
  const cloudRegion = useAuthStateValue((s) => s.cloudRegion);
  const { isLoading } = useIntegrations();
  const { slackIntegrations, hasSlackIntegration } = useIntegrationSelectors();

  const slackSettingsUrl = projectId
    ? getPostHogUrl(
        `/project/${projectId}/settings/project-integrations#integration-slack`,
        cloudRegion,
      )
    : null;

  const manageButton = (
    <Button
      size="1"
      disabled={!slackSettingsUrl}
      onClick={() => {
        if (slackSettingsUrl) void openUrlInBrowser(slackSettingsUrl);
      }}
    >
      <ArrowSquareOutIcon size={12} />
      Manage in PostHog Web
    </Button>
  );

  const manageButtonWithTooltip = slackSettingsUrl ? (
    manageButton
  ) : (
    <Tooltip content="Sign in to a PostHog project to manage the Slack integration">
      {manageButton}
    </Tooltip>
  );

  return (
    <Flex direction="column" gap="3">
      <Text className="text-(--gray-11) text-[13px]">
        Connect Slack to PostHog Code to kick off tasks like pull requests
        directly from Slack.
      </Text>

      <Flex direction="column" className="border-(--gray-5) border-t">
        {isLoading ? (
          <Flex align="center" gap="2" py="4">
            <Spinner size="1" />
            <Text className="text-(--gray-11) text-[13px]">Loading…</Text>
          </Flex>
        ) : hasSlackIntegration ? (
          slackIntegrations.map((integration) => (
            <SlackIntegrationRow
              key={integration.id}
              integration={integration}
            />
          ))
        ) : (
          <Flex align="center" gap="3" py="4">
            <Box className="shrink-0 text-(--gray-11)">
              <SlackLogoIcon size={20} />
            </Box>
            <Text className="text-(--gray-11) text-[13px]">
              No Slack workspace connected yet.
            </Text>
          </Flex>
        )}
      </Flex>

      <Flex>{manageButtonWithTooltip}</Flex>

      <SlackInboxNotificationsSettings isLoading={isLoading} />
    </Flex>
  );
}

interface SlackIntegrationRowProps {
  integration: Integration;
}

function SlackIntegrationRow({ integration }: SlackIntegrationRowProps) {
  const rawDisplayName = integration.display_name;
  const workspaceName =
    (typeof rawDisplayName === "string" && rawDisplayName.trim()) ||
    "Slack workspace";
  const createdAt =
    typeof integration.created_at === "string" ? integration.created_at : null;

  return (
    <Flex align="start" gap="3" py="3" className="border-(--gray-5) border-b">
      <Box className="shrink-0 text-(--gray-11)">
        <SlackLogoIcon size={28} />
      </Box>
      <Flex direction="column" gap="1" className="min-w-0">
        <Text className="text-(--gray-12) text-sm">
          <Text className="font-medium">Connected</Text> to{" "}
          <Text className="font-medium">{workspaceName}</Text>
        </Text>
        {createdAt && (
          <Text className="text-(--gray-11) text-[13px]">
            Created {formatRelativeTimeLong(createdAt)}
          </Text>
        )}
      </Flex>
    </Flex>
  );
}
