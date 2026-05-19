import { useOptionalAuthenticatedClient } from "@features/auth/hooks/authClient";
import { useSelectProjectMutation } from "@features/auth/hooks/authMutations";
import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { FolderPicker } from "@features/folder-picker/components/FolderPicker";
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
  CheckCircle,
  CircleNotch,
  FolderOpen,
  GearSix,
  GitBranch,
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
import builderHog from "@renderer/assets/images/hedgehogs/builder-hog-03.png";
import { trpcClient } from "@renderer/trpc/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { DetectedRepo } from "../hooks/useOnboardingFlow";
import { useProjectsWithIntegrations } from "../hooks/useProjectsWithIntegrations";
import { OnboardingHogTip } from "./OnboardingHogTip";
import { StepActions } from "./StepActions";

interface GitIntegrationStepProps {
  onNext: () => void;
  onBack: () => void;
  selectedDirectory: string;
  detectedRepo: DetectedRepo | null;
  isDetectingRepo: boolean;
  onDirectoryChange: (path: string) => void;
}

export function GitIntegrationStep({
  onNext,
  onBack,
  selectedDirectory,
  detectedRepo,
  isDetectingRepo,
  onDirectoryChange,
}: GitIntegrationStepProps) {
  const currentProjectId = useAuthStateValue((state) => state.projectId);
  const selectProjectMutation = useSelectProjectMutation();

  const queryClient = useQueryClient();
  const { projects, projectsWithGithub, isLoading } =
    useProjectsWithIntegrations();

  const manuallySelectedProjectId = useOnboardingStore(
    (state) => state.selectedProjectId,
  );
  const setSelectedProjectId = useOnboardingStore(
    (state) => state.selectProjectId,
  );

  const selectedProjectId = useMemo(() => {
    if (manuallySelectedProjectId !== null) {
      return manuallySelectedProjectId;
    }
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
  });
  const canTakeAction = !isConnecting && !timedOut && !hasConnectError;
  const defaultPanelMessage = hasConnectError
    ? describeGithubConnectError(connectError)
    : timedOut
      ? "We didn't hear back from GitHub. If the browser tab was closed, click Connect again."
      : isConnecting
        ? "Waiting for GitHub..."
        : "Optional. Unlocks cloud agents and pull request workflows.";

  const {
    data: githubUserIntegrations = [],
    isLoading: githubUserIntegrationsLoading,
  } = useUserGithubIntegrations();
  const hasGitIntegration = githubUserIntegrations.length > 0;
  const { repositories, failedInstallationIds, reposByInstallationId } =
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

  const repoMatchesGitHub = useMemo(() => {
    if (!detectedRepo || repositories.length === 0) return false;
    return repositories.some(
      (r) => r.toLowerCase() === detectedRepo.fullName.toLowerCase(),
    );
  }, [detectedRepo, repositories]);

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
      if (!apiClient) {
        throw new Error("Not authenticated");
      }
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

  const handleContinue = () => {
    if (selectedProjectId && selectedProjectId !== currentProjectId) {
      selectProjectMutation.mutate(selectedProjectId);
    }
    onNext();
  };

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
            style={{ margin: "auto auto" }}
            className="w-full max-w-[560px]"
          >
            {/* Header + content */}
            <Flex direction="column" gap="5" className="w-full">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Flex direction="column" gap="2">
                  <Text className="font-bold text-(--gray-12) text-2xl">
                    Give your agents access to code
                  </Text>
                  <Text className="text-(--gray-11) text-sm">
                    Point to a local codebase and optionally connect GitHub.
                  </Text>
                </Flex>
              </motion.div>

              {/* Local folder picker */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 }}
              >
                <Box
                  p="5"
                  style={{
                    boxShadow:
                      "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)",
                  }}
                  className="rounded-[12px] border border-(--gray-a3) bg-(--color-panel-solid)"
                >
                  <Flex direction="column" gap="4">
                    <Flex direction="column" gap="1">
                      <Flex align="center" gap="2">
                        <FolderOpen size={18} className="text-(--gray-12)" />
                        <Text className="font-bold text-(--gray-12) text-base">
                          Choose your codebase
                        </Text>
                      </Flex>
                      <Text className="text-(--gray-11) text-sm">
                        Select the local folder for your project so we can
                        analyze it.
                      </Text>
                    </Flex>
                    <FolderPicker
                      value={selectedDirectory}
                      onChange={onDirectoryChange}
                      placeholder="Select folder..."
                      size="2"
                    />
                    <AnimatePresence mode="wait">
                      {isDetectingRepo && (
                        <motion.div
                          key="detecting"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                        >
                          <Flex align="center" gap="2">
                            <CircleNotch
                              size={14}
                              className="animate-spin text-(--gray-9)"
                            />
                            <Text className="text-(--gray-9) text-[13px]">
                              Detecting repository...
                            </Text>
                          </Flex>
                        </motion.div>
                      )}
                      {!isDetectingRepo &&
                        selectedDirectory &&
                        detectedRepo && (
                          <motion.div
                            key="detected"
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <Flex align="center" gap="2">
                              <CheckCircle
                                size={14}
                                weight="fill"
                                style={{
                                  color: repoMatchesGitHub
                                    ? "var(--green-9)"
                                    : "var(--gray-9)",
                                }}
                              />
                              <Text
                                style={{
                                  color: repoMatchesGitHub
                                    ? "var(--green-11)"
                                    : "var(--gray-11)",
                                }}
                                className="text-[13px]"
                              >
                                {repoMatchesGitHub
                                  ? `Linked to ${detectedRepo.fullName} on GitHub`
                                  : `Detected ${detectedRepo.fullName}`}
                              </Text>
                            </Flex>
                          </motion.div>
                        )}
                      {!isDetectingRepo &&
                        selectedDirectory &&
                        !detectedRepo && (
                          <motion.div
                            key="no-repo"
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <Text className="text-(--gray-9) text-[13px]">
                              No git remote detected -- you can still continue.
                            </Text>
                          </motion.div>
                        )}
                    </AnimatePresence>
                  </Flex>
                </Box>
              </motion.div>

              {/* GitHub integration */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
              >
                <Box
                  p="5"
                  style={{
                    boxShadow:
                      "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)",
                  }}
                  className="rounded-[12px] border border-(--gray-a3) bg-(--color-panel-solid)"
                >
                  <Flex direction="column" gap="3">
                    <Flex align="center" justify="between">
                      <Flex align="center" gap="2">
                        <GitBranch size={18} className="text-(--gray-12)" />
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
                      ) : null}
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
                        <Flex direction="column" gap="3">
                          <Text className="text-(--gray-11) text-sm">
                            GitHub is already set up on{" "}
                            <Text className="font-bold">
                              {selectedProject.name}
                            </Text>
                            . Sign in with one click to link your account — no
                            admin approval needed.
                          </Text>
                          <Button
                            size="1"
                            variant="solid"
                            onClick={() => void handleConnectGitHub()}
                            className="self-start"
                          >
                            Sign in with GitHub
                            <ArrowSquareOut size={12} />
                          </Button>
                        </Flex>
                      ) : selectedAlternative &&
                        selectedProject &&
                        canTakeAction ? (
                        <Flex direction="column" gap="3">
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
                          <Flex direction="column" gap="2" align="start">
                            <Button
                              size="1"
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
                        </Flex>
                      ) : (
                        <Flex direction="column" gap="3">
                          <Text
                            className={
                              hasConnectError
                                ? "text-(--red-11) text-sm"
                                : "text-(--gray-11) text-sm"
                            }
                          >
                            {defaultPanelMessage}
                          </Text>
                          <Flex gap="2">
                            <Button
                              size="1"
                              variant="soft"
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
                                size="1"
                                variant="ghost"
                                color="gray"
                                onClick={resetConnect}
                              >
                                Dismiss
                              </Button>
                            )}
                          </Flex>
                        </Flex>
                      )
                    ) : null}
                  </Flex>
                </Box>
              </motion.div>
            </Flex>

            {/* Hog tip */}
            <OnboardingHogTip
              hogSrc={builderHog}
              message="GitHub access lets agents read issues and open pull requests for you."
              delay={0.15}
            />
          </Flex>
        </Flex>

        <StepActions>
          <Button size="3" variant="outline" color="gray" onClick={onBack}>
            <ArrowLeft size={16} weight="bold" />
            Back
          </Button>
          <Button
            size="3"
            onClick={handleContinue}
            disabled={!selectedDirectory}
          >
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
