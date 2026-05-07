import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import {
  describeGithubConnectError,
  useGithubConnect,
} from "@features/integrations/hooks/useGithubUserConnect";
import { useRepositoryIntegration } from "@hooks/useIntegrations";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  GitBranchIcon,
  InfoIcon,
} from "@phosphor-icons/react";
import { Box, Button, Flex, Spinner, Text, Tooltip } from "@radix-ui/themes";

export function GitHubIntegrationSection({
  hasGithubIntegration,
}: {
  hasGithubIntegration: boolean;
}) {
  const { repositories, isLoadingRepos } = useRepositoryIntegration();
  const projectId = useAuthStateValue((state) => state.projectId);
  const {
    error: connectError,
    isConnecting: connecting,
    isTimedOut: timedOut,
    hasError: hasConnectError,
    connect: handleConnect,
  } = useGithubConnect({
    projectId,
    projectHasTeamIntegration: hasGithubIntegration,
  });

  return (
    <Flex
      align="center"
      justify="between"
      gap="4"
      pb="4"
      className="border-(--gray-5) border-b border-dashed"
    >
      <Flex align="center" gap="3">
        <Box className="shrink-0 text-(--gray-11)">
          <GitBranchIcon size={20} />
        </Box>
        <Flex direction="column">
          <Text className="font-medium text-(--gray-12) text-sm">
            Project-level code access
          </Text>
          {hasGithubIntegration &&
          !isLoadingRepos &&
          repositories.length > 0 ? (
            <Tooltip
              content={
                <Flex direction="column" gap="1">
                  {repositories.map((repo) => (
                    <Text key={repo} className="text-[13px]">
                      {repo}
                    </Text>
                  ))}
                </Flex>
              }
              side="bottom"
            >
              <Flex align="center" gap="1" className="cursor-help">
                <Text className="text-(--gray-11) text-[13px]">
                  Connected and active ({repositories.length}{" "}
                  {repositories.length === 1 ? "repo" : "repos"})
                </Text>
                <InfoIcon size={13} className="shrink-0 text-(--gray-9)" />
              </Flex>
            </Tooltip>
          ) : (
            <Text
              className={
                hasConnectError
                  ? "text-(--red-11) text-[13px]"
                  : "text-(--gray-11) text-[13px]"
              }
            >
              {hasGithubIntegration
                ? "Connected and active"
                : hasConnectError
                  ? describeGithubConnectError(connectError)
                  : timedOut
                    ? "We didn't hear back from GitHub. Try again."
                    : "Required for the Inbox pipeline to work"}
            </Text>
          )}
        </Flex>
      </Flex>
      {connecting ? (
        <Spinner size="2" />
      ) : hasGithubIntegration ? (
        <Flex align="center" gap="2">
          <CheckCircleIcon
            size={16}
            weight="fill"
            className="text-(--green-9)"
          />
          <Button size="1" variant="soft" onClick={() => void handleConnect()}>
            Update in GitHub
            <ArrowSquareOutIcon size={12} />
          </Button>
        </Flex>
      ) : (
        <Button size="1" onClick={() => void handleConnect()}>
          {hasConnectError || timedOut ? "Try again" : "Connect GitHub"}
          <ArrowSquareOutIcon size={12} />
        </Button>
      )}
    </Flex>
  );
}
