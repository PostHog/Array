import { useAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { GitHubRepoPicker } from "@features/folder-picker/components/GitHubRepoPicker";
import {
  describeGithubConnectError,
  useGithubConnect,
} from "@features/integrations/hooks/useGithubUserConnect";
import {
  useGithubRepositories,
  useRepositoryIntegration,
} from "@hooks/useIntegrations";
import { Button } from "@posthog/quill";
import { Box, Flex, Text, TextField } from "@radix-ui/themes";
import { trpcClient } from "@renderer/trpc";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type DataSourceType = "github" | "linear" | "zendesk" | "pganalyze";

const REQUIRED_SCHEMAS: Record<DataSourceType, string[]> = {
  github: ["issues"],
  linear: ["issues"],
  zendesk: ["tickets"],
  pganalyze: ["issues", "servers"],
};

/** PostHog DWH: full table replication (non-incremental); API enum value `full_refresh`. */
const FULL_TABLE_REPLICATION = "full_refresh" as const;

function schemasPayload(source: DataSourceType) {
  return REQUIRED_SCHEMAS[source].map((name) => ({
    name,
    should_sync: true,
    sync_type: FULL_TABLE_REPLICATION,
  }));
}

interface DataSourceSetupProps {
  source: DataSourceType;
  onComplete: () => void;
  onCancel: () => void;
}

export function DataSourceSetup({
  source,
  onComplete,
  onCancel,
}: DataSourceSetupProps) {
  switch (source) {
    case "github":
      return <GitHubSetup onComplete={onComplete} onCancel={onCancel} />;
    case "linear":
      return <LinearSetup onComplete={onComplete} onCancel={onCancel} />;
    case "zendesk":
      return <ZendeskSetup onComplete={onComplete} onCancel={onCancel} />;
    case "pganalyze":
      return <PgAnalyzeSetup onComplete={onComplete} onCancel={onCancel} />;
  }
}

interface SetupFormProps {
  onComplete: () => void;
  onCancel: () => void;
}

function GitHubSetup({ onComplete, onCancel }: SetupFormProps) {
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  const client = useAuthenticatedClient();
  const {
    repositories,
    getIntegrationIdForRepo,
    isLoadingRepos,
    isRefreshingRepos,
    refreshRepositories,
    hasGithubIntegration,
  } = useRepositoryIntegration();
  const [repoPickerSearchQuery, setRepoPickerSearchQuery] = useState("");
  const [isRepoPickerOpen, setIsRepoPickerOpen] = useState(false);
  const {
    repositories: visibleRepositories,
    isPending: visibleRepositoriesLoading,
    hasMore: visibleRepositoriesHasMore,
    loadMore: loadMoreVisibleRepositories,
  } = useGithubRepositories(repoPickerSearchQuery, isRepoPickerOpen);
  const [repo, setRepo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const {
    error: connectError,
    isConnecting: connecting,
    isTimedOut: timedOut,
    hasError: hasConnectError,
    connect: handleConnectGitHub,
  } = useGithubConnect({
    projectId,
    projectHasTeamIntegration: hasGithubIntegration,
  });
  const selectedIntegrationId = repo
    ? getIntegrationIdForRepo(repo)
    : undefined;

  useEffect(() => {
    if (isLoadingRepos || !repo || repositories.includes(repo)) {
      return;
    }

    setRepo(null);
  }, [isLoadingRepos, repo, repositories]);

  // Auto-select the first repo once loaded
  useEffect(() => {
    if (repo === null && repositories.length > 0) {
      setRepo(repositories[0]);
    }
  }, [repo, repositories]);

  const handleSubmit = useCallback(async () => {
    if (!projectId || !client || !repo || !selectedIntegrationId) return;

    setLoading(true);
    try {
      await client.createExternalDataSource(projectId, {
        source_type: "Github",
        payload: {
          repository: repo,
          auth_method: {
            selection: "oauth",
            github_integration_id: selectedIntegrationId,
          },
          schemas: schemasPayload("github"),
        },
      });
      toast.success("GitHub data source created");
      onComplete();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create data source",
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, client, onComplete, repo, selectedIntegrationId]);

  const handleRefreshRepositories = useCallback(() => {
    void refreshRepositories()
      .then(() => {
        toast.success("Repositories refreshed");
      })
      .catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to refresh repositories",
        );
      });
  }, [refreshRepositories]);

  const handleRepoPickerOpenChange = useCallback((open: boolean) => {
    setIsRepoPickerOpen(open);
    if (!open) {
      setRepoPickerSearchQuery("");
    }
  }, []);

  const handleRepoPickerSearchChange = useCallback((value: string) => {
    setRepoPickerSearchQuery(value);
  }, []);

  if (!hasGithubIntegration) {
    const statusMessage = hasConnectError
      ? describeGithubConnectError(connectError)
      : timedOut
        ? "We didn't hear back from GitHub. If the browser tab was closed, click Try again."
        : connecting
          ? "Waiting for GitHub… finish authorizing in your browser, then return here."
          : "Connect your GitHub account to import issues as signals.";
    return (
      <SetupFormContainer title="Connect GitHub">
        <Flex direction="column" gap="3">
          <Text
            className={
              hasConnectError
                ? "text-(--red-11) text-sm"
                : "text-(--gray-11) text-sm"
            }
          >
            {statusMessage}
          </Text>
          <Flex gap="2" justify="end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void handleConnectGitHub()}
              disabled={connecting}
            >
              {connecting
                ? "Waiting for authorization..."
                : hasConnectError || timedOut
                  ? "Try again"
                  : "Connect GitHub"}
            </Button>
          </Flex>
        </Flex>
      </SetupFormContainer>
    );
  }

  return (
    <SetupFormContainer title="Connect GitHub">
      <Flex direction="column" gap="3">
        <GitHubRepoPicker
          value={repo}
          onChange={setRepo}
          repositories={isRepoPickerOpen ? visibleRepositories : repositories}
          isLoading={
            isLoadingRepos || (isRepoPickerOpen && visibleRepositoriesLoading)
          }
          isRefreshing={isRefreshingRepos}
          onRefresh={handleRefreshRepositories}
          open={isRepoPickerOpen}
          onOpenChange={handleRepoPickerOpenChange}
          searchQuery={repoPickerSearchQuery}
          onSearchQueryChange={handleRepoPickerSearchChange}
          hasMore={visibleRepositoriesHasMore}
          onLoadMore={loadMoreVisibleRepositories}
          placeholder="Select repository..."
          size="2"
        />

        <Flex gap="2" justify="end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={!repo || !selectedIntegrationId || loading}
          >
            {loading ? "Creating..." : "Create source"}
          </Button>
        </Flex>
      </Flex>
    </SetupFormContainer>
  );
}

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 300_000; // 5 minutes

function LinearSetup({ onComplete }: SetupFormProps) {
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  const client = useAuthenticatedClient();
  const [loading, setLoading] = useState(false);
  const [oauthConnected, setOauthConnected] = useState(false);
  const [linearIntegrationId, setLinearIntegrationId] = useState<
    number | string | null
  >(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => stopPolling, [stopPolling]);

  const handleOAuthConnect = useCallback(async () => {
    if (!cloudRegion || !projectId || !client) return;
    setLoading(true);
    setPollError(null);
    try {
      await trpcClient.linearIntegration.startFlow.mutate({
        region: cloudRegion,
        projectId,
      });

      // Poll for the new Linear integration
      pollTimerRef.current = setInterval(async () => {
        try {
          const integrations =
            await client.getIntegrationsForProject(projectId);
          const linearIntegration = integrations.find(
            (i: { kind: string }) => i.kind === "linear",
          ) as { id: number | string } | undefined;
          if (linearIntegration) {
            stopPolling();
            setLoading(false);
            setOauthConnected(true);
            setLinearIntegrationId(linearIntegration.id);
            toast.success("Linear connected");
          }
        } catch {
          // Ignore individual poll failures
        }
      }, POLL_INTERVAL_MS);

      // Timeout after 5 minutes
      pollTimeoutRef.current = setTimeout(() => {
        stopPolling();
        setLoading(false);
        setPollError("Connection timed out. Please try again.");
      }, POLL_TIMEOUT_MS);
    } catch (error) {
      setLoading(false);
      toast.error(
        error instanceof Error ? error.message : "Failed to connect Linear",
      );
    }
  }, [cloudRegion, projectId, client, stopPolling]);

  const handleSubmit = useCallback(async () => {
    if (!projectId || !client || !linearIntegrationId) return;

    setLoading(true);
    try {
      await client.createExternalDataSource(projectId, {
        source_type: "Linear",
        payload: {
          linear_integration_id: linearIntegrationId,
          schemas: schemasPayload("linear"),
        },
      });
      toast.success("Linear data source created");
      onComplete();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create data source",
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, client, linearIntegrationId, onComplete]);

  return (
    <SetupFormContainer title="Connect Linear">
      <Flex direction="column" gap="3">
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handleOAuthConnect}
          disabled={loading || oauthConnected}
        >
          {oauthConnected
            ? "Linear connected"
            : loading
              ? "Waiting for authorization..."
              : "Log into Linear to continue"}
        </Button>

        {pollError && (
          <Text className="text-(--red-11) text-sm">{pollError}</Text>
        )}

        <Flex gap="2" justify="end">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={!oauthConnected || loading}
          >
            {loading ? "Creating..." : "Create source"}
          </Button>
        </Flex>
      </Flex>
    </SetupFormContainer>
  );
}

function ZendeskSetup({ onComplete, onCancel }: SetupFormProps) {
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  const client = useAuthenticatedClient();
  const [subdomain, setSubdomain] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!projectId || !client) return;
    if (!subdomain.trim() || !apiKey.trim() || !email.trim()) {
      toast.error("Please fill in all fields");
      return;
    }

    setLoading(true);
    try {
      await client.createExternalDataSource(projectId, {
        source_type: "Zendesk",
        payload: {
          subdomain: subdomain.trim(),
          api_key: apiKey.trim(),
          email_address: email.trim(),
          schemas: schemasPayload("zendesk"),
        },
      });
      toast.success("Zendesk data source created");
      onComplete();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create data source",
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, client, subdomain, apiKey, email, onComplete]);

  const canSubmit = subdomain.trim() && apiKey.trim() && email.trim();

  return (
    <SetupFormContainer title="Connect Zendesk">
      <Flex direction="column" gap="3">
        <TextField.Root
          placeholder="Subdomain (e.g. mycompany)"
          value={subdomain}
          onChange={(e) => setSubdomain(e.target.value)}
        />
        <TextField.Root
          placeholder="API key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <TextField.Root
          placeholder="Email address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <Flex gap="2" justify="end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit || loading}
          >
            {loading ? "Creating..." : "Create source"}
          </Button>
        </Flex>
      </Flex>
    </SetupFormContainer>
  );
}

function PgAnalyzeSetup({ onComplete, onCancel }: SetupFormProps) {
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  const client = useAuthenticatedClient();
  const [apiKey, setApiKey] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!projectId || !client) return;
    if (!apiKey.trim() || !organizationSlug.trim()) {
      toast.error("Please fill in all fields");
      return;
    }

    setLoading(true);
    try {
      await client.createExternalDataSource(projectId, {
        source_type: "PgAnalyze",
        payload: {
          api_key: apiKey.trim(),
          organization_slug: organizationSlug.trim(),
          schemas: schemasPayload("pganalyze"),
        },
      });
      toast.success("pganalyze data source created");
      onComplete();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create data source",
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, client, apiKey, organizationSlug, onComplete]);

  const canSubmit = apiKey.trim() && organizationSlug.trim();

  return (
    <SetupFormContainer title="Connect pganalyze">
      <Flex direction="column" gap="3">
        <TextField.Root
          placeholder="Organization slug (e.g. my-company)"
          value={organizationSlug}
          onChange={(e) => setOrganizationSlug(e.target.value)}
        />
        <TextField.Root
          placeholder="API key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />

        <Flex gap="2" justify="end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit || loading}
          >
            {loading ? "Creating..." : "Create source"}
          </Button>
        </Flex>
      </Flex>
    </SetupFormContainer>
  );
}

function SetupFormContainer({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box p="4" className="border border-(--gray-4) bg-(--color-panel-solid)">
      <Flex direction="column" gap="3">
        <Flex align="center" justify="between">
          <Text className="font-medium text-(--gray-12) text-sm">{title}</Text>
        </Flex>
        {children}
      </Flex>
    </Box>
  );
}
