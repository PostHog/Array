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
import { Button } from "@posthog/quill";
import { Box, Flex, Spinner, Text, Tooltip } from "@radix-ui/themes";
import { useMemo } from "react";

/**
 * Past this count, the tooltip would become an unreadable wall of `owner/name`
 * rows, so we collapse to owner-level summaries instead.
 */
const REPO_LIST_TOOLTIP_THRESHOLD = 10;

function summarizeReposByOwner(
  repositories: readonly string[],
): { owner: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const repo of repositories) {
    const owner = repo.includes("/") ? (repo.split("/", 1)[0] ?? repo) : repo;
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([owner, count]) => ({ owner, count }))
    .sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner));
}

export function GitHubIntegrationSection({
  hasGithubIntegration,
  isLoading = false,
}: {
  hasGithubIntegration: boolean;
  isLoading?: boolean;
}) {
  const { repositories, isLoadingRepos } = useRepositoryIntegration();
  const ownerSummary = useMemo(
    () =>
      repositories.length > REPO_LIST_TOOLTIP_THRESHOLD
        ? summarizeReposByOwner(repositories)
        : null,
    [repositories],
  );
  const projectId = useAuthStateValue((state) => state.currentProjectId);
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

  if (isLoading) {
    return (
      <Flex
        align="center"
        justify="between"
        gap="4"
        pb="4"
        className="border-(--gray-5) border-b border-dashed"
      >
        <Flex align="center" gap="3" className="min-w-0 flex-1">
          <Box className="size-[20px] shrink-0 animate-pulse rounded bg-gray-4" />
          <Flex direction="column" gap="2" className="min-w-0 flex-1">
            <Box className="h-[12px] w-[40%] animate-pulse rounded bg-gray-4" />
            <Box className="h-[11px] w-[60%] animate-pulse rounded bg-gray-3" />
          </Flex>
        </Flex>
        <Box className="h-[24px] w-[120px] shrink-0 animate-pulse rounded bg-gray-3" />
      </Flex>
    );
  }

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
                ownerSummary ? (
                  <Flex direction="column" gap="1">
                    <Text className="text-(--gray-10) text-[13px]">
                      {repositories.length} repos across {ownerSummary.length}{" "}
                      {ownerSummary.length === 1 ? "owner" : "owners"}
                    </Text>
                    {ownerSummary.map(({ owner, count }) => (
                      <Text key={owner} className="text-[13px]">
                        {owner} ({count})
                      </Text>
                    ))}
                  </Flex>
                ) : (
                  <Flex direction="column" gap="1">
                    {repositories.map((repo) => (
                      <Text key={repo} className="text-[13px]">
                        {repo}
                      </Text>
                    ))}
                  </Flex>
                )
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
      ) : (
        <Flex align="center" gap="2">
          {hasGithubIntegration ? (
            <CheckCircleIcon
              size={16}
              weight="fill"
              className="text-(--green-9)"
            />
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleConnect()}
          >
            {hasGithubIntegration
              ? "Update in GitHub"
              : hasConnectError || timedOut
                ? "Try again"
                : "Connect GitHub"}
            <ArrowSquareOutIcon size={12} />
          </Button>
        </Flex>
      )}
    </Flex>
  );
}
