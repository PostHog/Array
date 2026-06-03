import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import {
  describeGithubConnectError,
  invalidateGithubQueries,
  useGithubConnect,
} from "@features/integrations/hooks/useGithubUserConnect";
import { useOnboardingStore } from "@features/onboarding/stores/onboardingStore";
import {
  useUserGithubIntegrations,
  useUserRepositoryIntegration,
} from "@hooks/useIntegrations";
import {
  ArrowSquareOut,
  ArrowsClockwise,
  CheckCircle,
  GearSix,
  GithubLogo,
  Plus,
} from "@phosphor-icons/react";
import {
  AlertDialog,
  Box,
  Button,
  DropdownMenu,
  Flex,
  Skeleton,
  Spinner,
  Text,
} from "@radix-ui/themes";
import { trpcClient } from "@renderer/trpc/client";
import {
  ANALYTICS_EVENTS,
  type OnboardingGithubConnectFlow,
} from "@shared/types/analytics";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { track } from "@utils/analytics";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useProjectsWithIntegrations } from "../hooks/useProjectsWithIntegrations";
import { OptionalBadge } from "./OptionalBadge";
import { PANEL_SHADOW } from "./onboardingStyles";

function getPanelMessage(opts: {
  hasConnectError: boolean;
  connectError: Parameters<typeof describeGithubConnectError>[0];
  timedOut: boolean;
  isConnecting: boolean;
}): string {
  if (opts.hasConnectError)
    return describeGithubConnectError(opts.connectError);
  if (opts.timedOut) {
    return "We didn't hear back from GitHub. If the browser tab was closed, click Connect again.";
  }
  if (opts.isConnecting) return "Waiting for GitHub...";
  return "Unlocks cloud runs, branch pushes, and PR review on this account.";
}

export function GitHubConnectPanel() {
  const queryClient = useQueryClient();
  const currentProjectId = useAuthStateValue((state) => state.currentProjectId);
  const { projects, projectsWithGithub, isLoading } =
    useProjectsWithIntegrations();
  const manuallySelectedProjectId = useOnboardingStore(
    (state) => state.selectedProjectId,
  );
  const setSelectedProjectId = useOnboardingStore(
    (state) => state.selectProjectId,
  );
  const selectedProjectId = useMemo(() => {
    if (manuallySelectedProjectId !== null) return manuallySelectedProjectId;
    return currentProjectId ?? projects[0]?.id ?? null;
  }, [manuallySelectedProjectId, currentProjectId, projects]);
  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId],
  );

  const {
    error: connectError,
    isConnecting,
    isTimedOut: timedOut,
    hasError: hasConnectError,
    connect: handleConnectGitHub,
    reset: resetConnect,
  } = useGithubConnect({
    projectId: selectedProjectId,
    projectHasTeamIntegration: selectedProject?.hasGithubIntegration ?? null,
    onConnected: () => track(ANALYTICS_EVENTS.ONBOARDING_GITHUB_CONNECTED),
  });
  const canTakeAction = !isConnecting && !timedOut && !hasConnectError;

  const initiateConnect = (
    flowType: OnboardingGithubConnectFlow,
    isRetry = false,
  ) => {
    track(ANALYTICS_EVENTS.ONBOARDING_GITHUB_CONNECT_STARTED, {
      flow_type: flowType,
      is_retry: isRetry,
    });
    void handleConnectGitHub();
  };

  const failureFingerprintRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasConnectError && !timedOut) {
      failureFingerprintRef.current = null;
      return;
    }
    const fingerprint = timedOut ? "timeout" : (connectError?.code ?? "error");
    if (failureFingerprintRef.current === fingerprint) return;
    failureFingerprintRef.current = fingerprint;
    track(ANALYTICS_EVENTS.ONBOARDING_GITHUB_CONNECT_FAILED, {
      reason: timedOut ? "timeout" : "error",
      error_type: connectError?.code ?? undefined,
    });
  }, [hasConnectError, timedOut, connectError]);

  const defaultPanelMessage = getPanelMessage({
    hasConnectError,
    connectError,
    timedOut,
    isConnecting,
  });

  const {
    data: githubUserIntegrations = [],
    isLoading: githubUserIntegrationsLoading,
  } = useUserGithubIntegrations();
  const hasGitIntegration = githubUserIntegrations.length > 0;
  const { failedInstallationIds, reposByInstallationId } =
    useUserRepositoryIntegration();
  const anyIntegrationStale = githubUserIntegrations.some((i) =>
    failedInstallationIds.includes(i.installation_id),
  );

  const alternativeConnectedProjects = useMemo(() => {
    if (hasGitIntegration) return [];
    if (!projectsWithGithub.length) return [];
    return projectsWithGithub.filter((p) => p.id !== selectedProjectId);
  }, [hasGitIntegration, projectsWithGithub, selectedProjectId]);
  const [selectedAlternativeId, setSelectedAlternativeId] = useState<
    number | null
  >(null);
  const selectedAlternative = useMemo(() => {
    if (!alternativeConnectedProjects.length) return null;
    return (
      alternativeConnectedProjects.find(
        (p) => p.id === selectedAlternativeId,
      ) ?? alternativeConnectedProjects[0]
    );
  }, [alternativeConnectedProjects, selectedAlternativeId]);

  const apiClient = useOptionalAuthenticatedClient();
  const [disconnectTarget, setDisconnectTarget] = useState<{
    installationId: string;
    accountName: string;
  } | null>(null);
  const [reconnectingInstallationId, setReconnectingInstallationId] = useState<
    string | null
  >(null);
  const disconnectMutation = useMutation({
    mutationFn: async (opts: { installationId: string; silent?: boolean }) => {
      if (!apiClient) throw new Error("Not authenticated");
      await apiClient.disconnectGithubUserIntegration(opts.installationId);
      return { silent: opts.silent ?? false };
    },
    onSuccess: ({ silent }) => {
      setDisconnectTarget(null);
      invalidateGithubQueries(queryClient, selectedProjectId);
      if (!silent) toast.success("GitHub disconnected.");
    },
    onError: (e) => {
      toast.error(
        e instanceof Error ? e.message : "Failed to disconnect GitHub.",
      );
    },
  });

  return (
    <>
      <Box
        p="5"
        style={{ boxShadow: PANEL_SHADOW }}
        className="rounded-[12px] border border-(--gray-a3) bg-(--color-panel-solid)"
      >
        <Flex direction="column" gap="4">
          <Flex direction="column" gap="1">
            <Flex align="center" justify="between" gap="2">
              <Flex align="center" gap="2">
                <GithubLogo size={18} className="text-(--gray-12)" />
                <Text className="font-bold text-(--gray-12) text-base">
                  Connect GitHub
                </Text>
              </Flex>
              {isLoading || githubUserIntegrationsLoading ? (
                <Skeleton className="h-[16px] w-[80px]" />
              ) : hasGitIntegration ? (
                anyIntegrationStale ? (
                  <Text className="text-(--amber-11) text-[13px]">
                    Reconnect needed
                  </Text>
                ) : (
                  <Flex align="center" gap="1">
                    <CheckCircle
                      size={14}
                      weight="fill"
                      className="text-(--green-9)"
                    />
                    <Text className="text-(--green-11) text-[13px]">
                      {githubUserIntegrations.length > 1
                        ? `Connected (${githubUserIntegrations.length})`
                        : "Connected"}
                    </Text>
                  </Flex>
                )
              ) : (
                <OptionalBadge />
              )}
            </Flex>
            {!hasGitIntegration &&
              !isLoading &&
              !githubUserIntegrationsLoading &&
              (selectedProject?.hasGithubIntegration && canTakeAction ? (
                <Text className="text-(--gray-11) text-sm">
                  GitHub is already set up on{" "}
                  <Text className="font-bold">{selectedProject.name}</Text>.
                  Sign in with one click to link your account, no admin approval
                  needed.
                </Text>
              ) : selectedAlternative && selectedProject && canTakeAction ? (
                <Text className="text-(--gray-11) text-sm">
                  GitHub is already connected on{" "}
                  {alternativeConnectedProjects.length > 1 ? (
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger>
                        <button
                          type="button"
                          className="cursor-pointer border-0 bg-transparent p-0 font-bold text-(--gray-12) underline"
                        >
                          {selectedAlternative.name} +{" "}
                          {alternativeConnectedProjects.length - 1} more
                        </button>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content size="1" align="start">
                        {alternativeConnectedProjects.map((p) => (
                          <DropdownMenu.Item
                            key={p.id}
                            onSelect={() => setSelectedAlternativeId(p.id)}
                          >
                            <Text className="text-[13px]">{p.name}</Text>
                            <Text className="ml-2 text-(--gray-10) text-[13px]">
                              {p.organization.name}
                            </Text>
                          </DropdownMenu.Item>
                        ))}
                      </DropdownMenu.Content>
                    </DropdownMenu.Root>
                  ) : (
                    <>
                      <Text className="font-bold">
                        {selectedAlternative.name}
                      </Text>{" "}
                      ({selectedAlternative.organization.name})
                    </>
                  )}
                  .
                </Text>
              ) : (
                <Text
                  className={
                    hasConnectError
                      ? "text-(--red-11) text-sm"
                      : "text-(--gray-11) text-sm"
                  }
                >
                  {defaultPanelMessage}
                </Text>
              ))}
          </Flex>
          {hasGitIntegration ? (
            <Flex direction="column" gap="3">
              {githubUserIntegrations.map((integration) => {
                const installationId = integration.installation_id;
                const accountName = integration.account?.name ?? "GitHub";
                const installRepos = reposByInstallationId[installationId];
                const isLoadingInstallRepos = installRepos === undefined;
                const isStale = failedInstallationIds.includes(installationId);
                const isReconnecting =
                  reconnectingInstallationId === installationId;
                return (
                  <Flex
                    key={integration.id}
                    direction="column"
                    gap="2"
                    p="3"
                    className="rounded-[8px] border border-(--gray-a3)"
                  >
                    <Flex align="center" justify="between" gap="2" wrap="wrap">
                      <Flex align="center" gap="2">
                        <Text className="font-bold text-(--gray-12) text-sm">
                          {accountName}
                        </Text>
                        <Text className="text-(--gray-10) text-[12px]">
                          {integration.account?.type === "Organization"
                            ? "org"
                            : "personal"}
                        </Text>
                      </Flex>
                      {isStale ? (
                        <Text className="text-(--amber-11) text-[12px]">
                          Reconnect needed
                        </Text>
                      ) : (
                        <Text className="text-(--gray-10) text-[12px]">
                          {isLoadingInstallRepos
                            ? "Loading…"
                            : installRepos.length === 1
                              ? "1 repo"
                              : `${installRepos.length} repos`}
                        </Text>
                      )}
                    </Flex>
                    <Flex align="center" gap="3" wrap="wrap">
                      {isStale && (
                        <Button
                          size="1"
                          variant="solid"
                          loading={isReconnecting}
                          disabled={
                            reconnectingInstallationId !== null &&
                            !isReconnecting
                          }
                          onClick={async () => {
                            track(
                              ANALYTICS_EVENTS.ONBOARDING_GITHUB_CONNECT_STARTED,
                              { flow_type: "user_new", is_retry: true },
                            );
                            setReconnectingInstallationId(installationId);
                            try {
                              await disconnectMutation.mutateAsync({
                                installationId,
                                silent: true,
                              });
                            } catch {
                              setReconnectingInstallationId(null);
                              return;
                            }
                            try {
                              await handleConnectGitHub();
                            } finally {
                              setReconnectingInstallationId(null);
                            }
                          }}
                        >
                          Reconnect
                          <ArrowSquareOut size={12} />
                        </Button>
                      )}
                      <Button
                        size="1"
                        variant="soft"
                        color="gray"
                        onClick={() => {
                          const account = integration.account;
                          const url =
                            account?.type === "Organization" && account.name
                              ? `https://github.com/organizations/${account.name}/settings/installations/${installationId}`
                              : `https://github.com/settings/installations/${installationId}`;
                          trpcClient.os.openExternal.mutate({ url });
                        }}
                      >
                        <GearSix size={12} />
                        Settings
                      </Button>
                      <Button
                        size="1"
                        variant="soft"
                        color="red"
                        onClick={() =>
                          setDisconnectTarget({ installationId, accountName })
                        }
                      >
                        Disconnect
                      </Button>
                    </Flex>
                  </Flex>
                );
              })}
              <Flex align="center" gap="3" wrap="wrap">
                <Button
                  size="1"
                  variant="soft"
                  color="gray"
                  onClick={() => {
                    queryClient.invalidateQueries({
                      queryKey: ["integrations"],
                    });
                    queryClient.invalidateQueries({
                      queryKey: ["user-github-integrations"],
                    });
                  }}
                >
                  <ArrowsClockwise size={12} />
                  Refresh
                </Button>
                <Button
                  size="1"
                  variant="ghost"
                  color="gray"
                  onClick={() => initiateConnect("user_new")}
                  loading={isConnecting}
                >
                  <Plus size={12} />
                  Add another GitHub org
                </Button>
              </Flex>
            </Flex>
          ) : !isLoading && !githubUserIntegrationsLoading ? (
            selectedProject?.hasGithubIntegration && canTakeAction ? (
              <Button
                size="2"
                variant="solid"
                onClick={() => initiateConnect("team_existing")}
                className="self-start"
              >
                Sign in with GitHub
                <ArrowSquareOut size={12} />
              </Button>
            ) : selectedAlternative && selectedProject && canTakeAction ? (
              <Flex direction="column" gap="2" align="start">
                <Button
                  size="2"
                  variant="solid"
                  onClick={() => initiateConnect("team_alternative")}
                >
                  Connect GitHub on {selectedProject.name}
                  <ArrowSquareOut size={12} />
                </Button>
                <Button
                  size="1"
                  variant="ghost"
                  color="gray"
                  onClick={() => setSelectedProjectId(selectedAlternative.id)}
                >
                  Switch to {selectedAlternative.name}
                </Button>
              </Flex>
            ) : (
              <Flex gap="2" align="center">
                <Button
                  size="2"
                  variant="solid"
                  onClick={() => {
                    const isRetry = hasConnectError || timedOut;
                    if (hasConnectError) resetConnect();
                    initiateConnect("user_new", isRetry);
                  }}
                  loading={isConnecting}
                >
                  {isConnecting
                    ? "Retry connection"
                    : hasConnectError || timedOut
                      ? "Try again"
                      : "Connect GitHub"}
                  <ArrowSquareOut size={12} />
                </Button>
                {hasConnectError && (
                  <Button
                    size="2"
                    variant="ghost"
                    color="gray"
                    onClick={resetConnect}
                  >
                    Dismiss
                  </Button>
                )}
              </Flex>
            )
          ) : null}
        </Flex>
      </Box>

      <AlertDialog.Root
        open={disconnectTarget !== null}
        onOpenChange={(next) => {
          if (!next && !disconnectMutation.isPending) {
            setDisconnectTarget(null);
          }
        }}
      >
        <AlertDialog.Content maxWidth="450px">
          <AlertDialog.Title>
            Disconnect{" "}
            {disconnectTarget ? disconnectTarget.accountName : "GitHub"}
          </AlertDialog.Title>
          <AlertDialog.Description className="text-sm">
            This removes your personal GitHub authorization from PostHog. You
            can reconnect at any time. The GitHub App itself stays installed in
            your org — uninstall it on GitHub if you want to remove that too.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button
                variant="soft"
                color="gray"
                disabled={disconnectMutation.isPending}
              >
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <Button
              variant="solid"
              color="red"
              onClick={() => {
                if (!disconnectTarget) return;
                disconnectMutation.mutate({
                  installationId: disconnectTarget.installationId,
                });
              }}
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending ? <Spinner size="1" /> : null}
              Disconnect
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
