import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Button, Flex, Text, Tooltip } from "@radix-ui/themes";
import { openUrlInBrowser } from "@utils/browser";
import { getPostHogUrl } from "@utils/urls";

export function SlackSettings() {
  const projectId = useAuthStateValue((s) => s.projectId);
  const cloudRegion = useAuthStateValue((s) => s.cloudRegion);

  const slackSettingsUrl = projectId
    ? getPostHogUrl(
        `/project/${projectId}/settings/project-posthog-code#integration-posthog-code-slack`,
        cloudRegion,
      )
    : null;

  const button = (
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

  return (
    <Flex direction="column" gap="3">
      <Text className="text-(--gray-11) text-[13px]">
        Connect Slack to PostHog Code to kick off tasks like pull requests
        directly from Slack.
      </Text>
      <Flex>
        {slackSettingsUrl ? (
          button
        ) : (
          <Tooltip content="Sign in to a PostHog project to manage the Slack integration">
            {button}
          </Tooltip>
        )}
      </Flex>
    </Flex>
  );
}
