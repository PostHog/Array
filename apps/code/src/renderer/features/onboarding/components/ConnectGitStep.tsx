import { Tooltip } from "@components/ui/Tooltip";
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
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  ArrowsClockwise,
  Check,
  CheckCircle,
  CircleNotch,
  Cloud,
  Copy,
  GearSix,
  GitBranch,
  GithubLogo,
  GitPullRequest,
  Plus,
  Warning,
} from "@phosphor-icons/react";
import {
  AlertDialog,
  Box,
  Button,
  DropdownMenu,
  Flex,
  IconButton,
  Skeleton,
  Spinner,
  Text,
} from "@radix-ui/themes";
import builderHog from "@renderer/assets/images/hedgehogs/builder-hog-03.png";
import { trpcClient, useTRPC } from "@renderer/trpc/client";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { track } from "@utils/analytics";
import { EXTERNAL_LINKS } from "@utils/links";
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useProjectsWithIntegrations } from "../hooks/useProjectsWithIntegrations";
import { OnboardingHogTip } from "./OnboardingHogTip";
import { StepActions } from "./StepActions";

const PANEL_SHADOW = "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)";

function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [command]);

  return (
    <Flex
      align="center"
      justify="between"
      gap="2"
      className="rounded-(--radius-2) border border-(--gray-a3) bg-(--gray-2) py-[6px] pr-2 pl-3"
    >
      <Flex align="center" gap="2" className="min-w-0">
        <Text className="select-none font-[var(--code-font-family)] text-(--gray-9) text-sm">
          $
        </Text>
        <Text className="truncate font-[var(--code-font-family)] text-(--gray-12) text-sm">
          {command}
        </Text>
      </Flex>
      <Tooltip content={copied ? "Copied!" : "Copy command"}>
        <IconButton
          size="1"
          variant="ghost"
          color="gray"
          onClick={() => void handleCopy()}
          aria-label="Copy command"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </IconButton>
      </Tooltip>
    </Flex>
  );
}

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

interface ConnectGitStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function ConnectGitStep({ onNext, onBack }: ConnectGitStepProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [isCheckingGit, setIsCheckingGit] = useState(false);
  const [isCheckingGh, setIsCheckingGh] = useState(false);
  const { data: gitStatus, isLoading: isLoadingGit } = useQuery(
    trpc.git.getGitStatus.queryOptions(undefined, { staleTime: 30_000 }),
  );
  const { data: ghStatus, isLoading: isLoadingGh } = useQuery(
    trpc.git.getGhStatus.queryOptions(undefined, { staleTime: 30_000 }),
  );
  const gitInstalled = gitStatus?.installed ?? false;
  const ghInstalled = ghStatus?.installed ?? false;
  const ghAuthenticated = ghStatus?.authenticated ?? false;

  const checkFiredRef = useRef(false);
  useEffect(() => {
    if (checkFiredRef.current) return;
    if (gitStatus === undefined || ghStatus === undefined) return;
    checkFiredRef.current = true;
    track(ANALYTICS_EVENTS.ONBOARDING_CLI_CHECK_COMPLETED, {
      git_installed: gitInstalled,
      gh_installed: ghInstalled,
      gh_authenticated: ghAuthenticated,
    });
  }, [gitStatus, ghStatus, gitInstalled, ghInstalled, ghAuthenticated]);

  const handleCheckGit = useCallback(async () => {
    setIsCheckingGit(true);
    await queryClient.invalidateQueries(trpc.git.getGitStatus.queryFilter());
    setIsCheckingGit(false);
  }, [queryClient, trpc]);

  const handleCheckGh = useCallback(async () => {
    setIsCheckingGh(true);
    await queryClient.invalidateQueries(trpc.git.getGhStatus.queryFilter());
    setIsCheckingGh(false);
  }, [queryClient, trpc]);

  const currentProjectId = useAuthStateValue((state) => state.projectId);
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
    <Flex align="center" height="100%" px="8">
      <Flex
        direction="column"
        align="center"
        className="h-full w-full pt-[24px] pb-[40px]"
      >
        <Flex direction="column" className="min-h-0 flex-1 overflow-y-auto">
          <Flex
            direction="column"
            gap="5"
            className="m-auto w-full max-w-[560px]"
          >
            <Flex direction="column" gap="5" className="w-full">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Flex direction="column" gap="2">
                  <Text className="font-bold text-(--gray-12) text-2xl">
                    Connect Git
                  </Text>
                  <Text className="text-(--gray-11) text-sm">
                    Optional, but it unlocks the parts of PostHog Code that
                    leave your machine.
                  </Text>
                </Flex>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.03 }}
              >
                <Flex direction="column" gap="2">
                  <Flex align="center" gap="2">
                    <Cloud size={16} className="text-(--gray-11)" />
                    <Text className="text-(--gray-11) text-sm">
                      Run tasks in cloud sandboxes instead of your machine.
                    </Text>
                  </Flex>
                  <Flex align="center" gap="2">
                    <GitPullRequest size={16} className="text-(--gray-11)" />
                    <Text className="text-(--gray-11) text-sm">
                      Push branches and open pull requests from agents.
                    </Text>
                  </Flex>
                  <Flex align="center" gap="2">
                    <CheckCircle size={16} className="text-(--gray-11)" />
                    <Text className="text-(--gray-11) text-sm">
                      Review PR comments and reply to threads from inside the
                      app.
                    </Text>
                  </Flex>
                </Flex>
              </motion.div>

              <motion.div
                key="github-panel"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 }}
              >
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
                          <span className="inline-flex items-center rounded-[6px] bg-(--gray-a3) px-[6px] py-px font-medium text-(--gray-11) text-[11px]">
                            Optional
                          </span>
                        )}
                      </Flex>
                      {!hasGitIntegration &&
                        !isLoading &&
                        !githubUserIntegrationsLoading &&
                        (selectedProject?.hasGithubIntegration &&
                        canTakeAction ? (
                          <Text className="text-(--gray-11) text-sm">
                            GitHub is already set up on{" "}
                            <Text className="font-bold">
                              {selectedProject.name}
                            </Text>
                            . Sign in with one click to link your account, no
                            admin approval needed.
                          </Text>
                        ) : selectedAlternative &&
                          selectedProject &&
                          canTakeAction ? (
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
                                    {alternativeConnectedProjects.length - 1}{" "}
                                    more
                                  </button>
                                </DropdownMenu.Trigger>
                                <DropdownMenu.Content size="1" align="start">
                                  {alternativeConnectedProjects.map((p) => (
                                    <DropdownMenu.Item
                                      key={p.id}
                                      onSelect={() =>
                                        setSelectedAlternativeId(p.id)
                                      }
                                    >
                                      <Text className="text-[13px]">
                                        {p.name}
                                      </Text>
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
                          const accountName =
                            integration.account?.name ?? "GitHub";
                          const installRepos =
                            reposByInstallationId[installationId];
                          const isLoadingInstallRepos =
                            installRepos === undefined;
                          const isStale =
                            failedInstallationIds.includes(installationId);
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
                              <Flex
                                align="center"
                                justify="between"
                                gap="2"
                                wrap="wrap"
                              >
                                <Flex align="center" gap="2">
                                  <Text className="font-bold text-(--gray-12) text-sm">
                                    {accountName}
                                  </Text>
                                  <Text className="text-(--gray-10) text-[12px]">
                                    {integration.account?.type ===
                                    "Organization"
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
                                      setReconnectingInstallationId(
                                        installationId,
                                      );
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
                                      account?.type === "Organization" &&
                                      account.name
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
                                    setDisconnectTarget({
                                      installationId,
                                      accountName,
                                    })
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
                            onClick={() => void handleConnectGitHub()}
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
                          onClick={() => void handleConnectGitHub()}
                          className="self-start"
                        >
                          Sign in with GitHub
                          <ArrowSquareOut size={12} />
                        </Button>
                      ) : selectedAlternative &&
                        selectedProject &&
                        canTakeAction ? (
                        <Flex direction="column" gap="2" align="start">
                          <Button
                            size="2"
                            variant="solid"
                            onClick={() => void handleConnectGitHub()}
                          >
                            Connect GitHub on {selectedProject.name}
                            <ArrowSquareOut size={12} />
                          </Button>
                          <Button
                            size="1"
                            variant="ghost"
                            color="gray"
                            onClick={() =>
                              setSelectedProjectId(selectedAlternative.id)
                            }
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
                              if (hasConnectError) resetConnect();
                              void handleConnectGitHub();
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
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.08 }}
              >
                <Box
                  p="5"
                  style={{ boxShadow: PANEL_SHADOW }}
                  className="rounded-[12px] border border-(--gray-a3) bg-(--color-panel-solid)"
                >
                  <Flex direction="column" gap="3">
                    <Flex align="center" justify="between">
                      <Flex align="center" gap="2">
                        <GitBranch size={18} className="text-(--gray-12)" />
                        <Text className="font-bold text-(--gray-12) text-base">
                          Git
                        </Text>
                      </Flex>
                      {isLoadingGit && (
                        <CircleNotch
                          size={14}
                          className="animate-spin text-(--gray-9)"
                        />
                      )}
                      {!isLoadingGit && gitInstalled && (
                        <Flex align="center" gap="1">
                          <CheckCircle
                            size={14}
                            weight="fill"
                            className="text-(--green-9)"
                          />
                          <Text className="text-(--green-11) text-[13px]">
                            Installed
                            {gitStatus?.version
                              ? ` (${gitStatus.version})`
                              : ""}
                          </Text>
                        </Flex>
                      )}
                    </Flex>
                    {!isLoadingGit && !gitInstalled && (
                      <Flex direction="column" gap="3">
                        <Text className="text-(--gray-11) text-sm">
                          Install with Homebrew or Xcode Command Line Tools:
                        </Text>
                        <Flex direction="column" gap="2">
                          <CommandLine command="brew install git" />
                          <CommandLine command="xcode-select --install" />
                        </Flex>
                        <Flex align="center" justify="between" gap="3">
                          <Button
                            size="1"
                            variant="ghost"
                            color="gray"
                            onClick={() =>
                              trpcClient.os.openExternal.mutate({
                                url: EXTERNAL_LINKS.gitInstall,
                              })
                            }
                          >
                            Other install methods
                            <ArrowSquareOut size={12} />
                          </Button>
                          <Button
                            size="1"
                            variant="soft"
                            color="gray"
                            onClick={() => void handleCheckGit()}
                            loading={isCheckingGit}
                          >
                            <ArrowsClockwise size={12} />
                            Check again
                          </Button>
                        </Flex>
                      </Flex>
                    )}
                  </Flex>
                </Box>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
              >
                <Box
                  p="5"
                  style={{ boxShadow: PANEL_SHADOW }}
                  className="rounded-[12px] border border-(--gray-a3) bg-(--color-panel-solid)"
                >
                  <Flex direction="column" gap="3">
                    <Flex align="center" justify="between">
                      <Flex align="center" gap="2">
                        <GithubLogo size={18} className="text-(--gray-12)" />
                        <Text className="font-bold text-(--gray-12) text-base">
                          GitHub CLI
                        </Text>
                      </Flex>
                      {isLoadingGh && (
                        <CircleNotch
                          size={14}
                          className="animate-spin text-(--gray-9)"
                        />
                      )}
                      {!isLoadingGh && ghInstalled && ghAuthenticated && (
                        <Flex align="center" gap="1">
                          <CheckCircle
                            size={14}
                            weight="fill"
                            className="text-(--green-9)"
                          />
                          <Text className="text-(--green-11) text-[13px]">
                            {ghStatus?.username
                              ? `Logged in as ${ghStatus.username}`
                              : "Authenticated"}
                          </Text>
                        </Flex>
                      )}
                      {!isLoadingGh && ghInstalled && !ghAuthenticated && (
                        <Flex align="center" gap="1">
                          <Warning
                            size={14}
                            weight="fill"
                            className="text-(--amber-9)"
                          />
                          <Text className="text-(--amber-11) text-[13px]">
                            Not logged in
                          </Text>
                        </Flex>
                      )}
                    </Flex>
                    {!isLoadingGh && !ghInstalled && (
                      <Flex direction="column" gap="3">
                        <Text className="text-(--gray-11) text-sm">
                          Install with Homebrew:
                        </Text>
                        <CommandLine command="brew install gh" />
                        <Flex align="center" justify="between" gap="3">
                          <Button
                            size="1"
                            variant="ghost"
                            color="gray"
                            onClick={() =>
                              trpcClient.os.openExternal.mutate({
                                url: EXTERNAL_LINKS.ghInstall,
                              })
                            }
                          >
                            Other install methods
                            <ArrowSquareOut size={12} />
                          </Button>
                          <Button
                            size="1"
                            variant="soft"
                            color="gray"
                            onClick={() => void handleCheckGh()}
                            loading={isCheckingGh}
                          >
                            <ArrowsClockwise size={12} />
                            Check again
                          </Button>
                        </Flex>
                      </Flex>
                    )}
                    {!isLoadingGh && ghInstalled && !ghAuthenticated && (
                      <Flex direction="column" gap="3">
                        <Text className="text-(--gray-11) text-sm">
                          Run this in your terminal to log in:
                        </Text>
                        <CommandLine command="gh auth login" />
                        <Flex justify="end">
                          <Button
                            size="1"
                            variant="soft"
                            color="gray"
                            onClick={() => void handleCheckGh()}
                            loading={isCheckingGh}
                          >
                            <ArrowsClockwise size={12} />
                            Check again
                          </Button>
                        </Flex>
                      </Flex>
                    )}
                  </Flex>
                </Box>
              </motion.div>
            </Flex>

            <OnboardingHogTip
              hogSrc={builderHog}
              message="You can skip this and still use local tasks. Come back any time to unlock cloud runs."
              delay={0.15}
            />
          </Flex>
        </Flex>

        <StepActions>
          <Button size="3" variant="outline" color="gray" onClick={onBack}>
            <ArrowLeft size={16} weight="bold" />
            Back
          </Button>
          <Button size="3" onClick={onNext}>
            Continue
            <ArrowRight size={16} weight="bold" />
          </Button>
        </StepActions>

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
              can reconnect at any time. The GitHub App itself stays installed
              in your org — uninstall it on GitHub if you want to remove that
              too.
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
      </Flex>
    </Flex>
  );
}
