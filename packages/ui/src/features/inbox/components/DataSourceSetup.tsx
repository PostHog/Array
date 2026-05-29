import type { DataSourceService } from "@posthog/core/inbox/dataSourceService";
import { DATA_SOURCE_SERVICE } from "@posthog/core/inbox/identifiers";
import { useService } from "@posthog/di/react";
import { Button } from "@posthog/quill";
import { useAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { GitHubRepoPicker } from "@posthog/ui/features/folder-picker/GitHubRepoPicker";
import {
  describeGithubConnectError,
  useGithubConnect,
} from "@posthog/ui/features/integrations/useGithubUserConnect";
import {
  useGithubRepositories,
  useRepositoryIntegration,
} from "@posthog/ui/features/integrations/useIntegrations";
import { toast } from "@posthog/ui/primitives/toast";
import { Box, Flex, Text, TextField } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";

type DataSourceType = "github" | "linear" | "zendesk" | "pganalyze";

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
  const dataSourceService = useService<DataSourceService>(DATA_SOURCE_SERVICE);
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
      await dataSourceService.createGithubDataSource(client, projectId, {
        repository: repo,
        githubIntegrationId: selectedIntegrationId,
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
  }, [
    projectId,
    client,
    onComplete,
    repo,
    selectedIntegrationId,
    dataSourceService,
  ]);

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

function LinearSetup({ onComplete }: SetupFormProps) {
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);
  const projectId = useAuthStateValue((state) => state.currentProjectId);
  const client = useAuthenticatedClient();
  const dataSourceService = useService<DataSourceService>(DATA_SOURCE_SERVICE);
  const [loading, setLoading] = useState(false);
  const [oauthConnected, setOauthConnected] = useState(false);
  const [linearIntegrationId, setLinearIntegrationId] = useState<
    number | string | null
  >(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      pollAbortRef.current?.abort();
    },
    [],
  );

  const handleOAuthConnect = useCallback(async () => {
    if (!cloudRegion || !projectId || !client) return;
    setLoading(true);
    setPollError(null);
    const controller = new AbortController();
    pollAbortRef.current = controller;
    try {
      const integrationId =
        await dataSourceService.connectLinearAndAwaitIntegration(
          client,
          cloudRegion,
          projectId,
          controller.signal,
        );
      setLoading(false);
      setOauthConnected(true);
      setLinearIntegrationId(integrationId);
      toast.success("Linear connected");
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoading(false);
      setPollError(
        error instanceof Error ? error.message : "Failed to connect Linear",
      );
    }
  }, [cloudRegion, projectId, client, dataSourceService]);

  const handleSubmit = useCallback(async () => {
    if (!projectId || !client || !linearIntegrationId) return;

    setLoading(true);
    try {
      await dataSourceService.createLinearDataSource(
        client,
        projectId,
        linearIntegrationId,
      );
      toast.success("Linear data source created");
      onComplete();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create data source",
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, client, linearIntegrationId, onComplete, dataSourceService]);

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
  const dataSourceService = useService<DataSourceService>(DATA_SOURCE_SERVICE);
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
      await dataSourceService.createZendeskDataSource(client, projectId, {
        subdomain: subdomain.trim(),
        apiKey: apiKey.trim(),
        email: email.trim(),
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
  }, [
    projectId,
    client,
    subdomain,
    apiKey,
    email,
    onComplete,
    dataSourceService,
  ]);

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
  const dataSourceService = useService<DataSourceService>(DATA_SOURCE_SERVICE);
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
      await dataSourceService.createPgAnalyzeDataSource(client, projectId, {
        apiKey: apiKey.trim(),
        organizationSlug: organizationSlug.trim(),
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
  }, [
    projectId,
    client,
    apiKey,
    organizationSlug,
    onComplete,
    dataSourceService,
  ]);

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
