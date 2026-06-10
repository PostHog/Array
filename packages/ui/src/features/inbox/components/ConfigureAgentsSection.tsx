import { ArrowSquareOutIcon, PlugsConnectedIcon } from "@phosphor-icons/react";
import {
  REPORT_MODEL_RESOLVER,
  type ReportModelResolver,
} from "@posthog/core/inbox/identifiers";
import {
  TASK_SERVICE,
  type TaskCreationInput,
  type TaskService,
} from "@posthog/core/task-detail/taskService";
import { useService } from "@posthog/di/react";
import { Button } from "@posthog/quill";
import { ANALYTICS_EVENTS, getCloudUrlFromRegion } from "@posthog/shared";
import { SELF_DRIVING_SETUP_TASK_FLAG } from "@posthog/shared/constants";
import type { SignalReportPriority } from "@posthog/shared/types";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { DataSourceSetup } from "@posthog/ui/features/inbox/components/DataSourceSetup";
import {
  ResponderAgentRoster,
  ResponderAgentRosterSkeleton,
} from "@posthog/ui/features/inbox/components/ResponderAgentRoster";
import { resolveDefaultModel } from "@posthog/ui/features/inbox/hooks/resolveDefaultModel";
import { useSignalSourceManager } from "@posthog/ui/features/inbox/hooks/useSignalSourceManager";
import {
  useIntegrations,
  useRepositoryIntegration,
  useUserRepositoryIntegration,
} from "@posthog/ui/features/integrations/useIntegrations";
import { SettingsOptionSelect } from "@posthog/ui/features/settings/SettingsOptionSelect";
import { GitHubIntegrationSection } from "@posthog/ui/features/settings/sections/GitHubIntegrationSection";
import { SlackInboxNotificationsSettings } from "@posthog/ui/features/settings/sections/SlackInboxNotificationsSettings";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { useCreateTask } from "@posthog/ui/features/tasks/useTaskCrudMutations";
import { Badge } from "@posthog/ui/primitives/Badge";
import { toast } from "@posthog/ui/primitives/toast";
import { openTask } from "@posthog/ui/router/useOpenTask";
import { track } from "@posthog/ui/shell/analytics";
import { logger } from "@posthog/ui/shell/logger";
import { Box, Flex, Text, Tooltip } from "@radix-ui/themes";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { toast as sonnerToast } from "sonner";

const AUTOSTART_PRIORITY_OPTIONS: {
  value: SignalReportPriority;
  label: string;
}[] = [
  { value: "P0", label: "P0 – Critical only" },
  { value: "P1", label: "P1 – High and above" },
  { value: "P2", label: "P2 – Medium and above" },
  { value: "P3", label: "P3 – Low and above" },
  { value: "P4", label: "P4 – All priorities" },
];

const NEVER_AUTOSTART_VALUE = "__never__";

const USER_AUTOSTART_OPTIONS: { value: string; label: string }[] = [
  { value: NEVER_AUTOSTART_VALUE, label: "Never – review everything first" },
  ...AUTOSTART_PRIORITY_OPTIONS,
];

const AUTONOMY_SETUP_PROMPT = `Set up PostHog Self-driving for this product.

Inspect the connected PostHog project and repository, figure out which Self-driving inputs would be useful first, connect the minimum useful context, and leave a concise report of what is configured and what still needs user input. Do not invent integrations that are not available.`;

const log = logger.scope("agents-setup-task");

export function ConfigureAgentsSection() {
  const {
    displayValues,
    sourceStates,
    setupSource,
    isLoading,
    handleToggle,
    handleSetup,
    handleSetupComplete,
    handleSetupCancel,
    userAutonomyConfig,
    userAutonomyConfigLoading,
    handleUpdateUserAutonomyPriority,
    evaluationsUrl,
  } = useSignalSourceManager();
  const { hasGithubIntegration, isLoadingIntegrations } =
    useRepositoryIntegration();
  const { isLoading: isLoadingSlackIntegrations } = useIntegrations();
  const isLoadingSlack = isLoadingIntegrations || isLoadingSlackIntegrations;
  const showSetupTask = useFeatureFlag(SELF_DRIVING_SETUP_TASK_FLAG);
  const userAutostartPriority =
    userAutonomyConfig?.autostart_priority ?? NEVER_AUTOSTART_VALUE;

  return (
    <Flex direction="column" gap="8">
      {showSetupTask ? <SetupTaskSection /> : null}

      <Subsection
        title="Connections"
        description="Foundational integrations responders read from and write to."
      >
        <GitHubIntegrationSection
          hasGithubIntegration={hasGithubIntegration}
          isLoading={isLoadingIntegrations}
          showBottomBorder={false}
        />
      </Subsection>

      <Subsection
        title="Responders"
        description="Each source: 1. watches for signals, 2. spins up a Responder when something matters, 3. hands you solutions."
      >
        {isLoading ? (
          <ResponderAgentRosterSkeleton />
        ) : (
          <Tooltip
            content="Connect code access to configure Self-driving inputs"
            hidden={hasGithubIntegration}
          >
            <Box
              className={
                !hasGithubIntegration
                  ? "pointer-events-none opacity-65"
                  : undefined
              }
            >
              {setupSource ? (
                <DataSourceSetup
                  source={setupSource}
                  onComplete={() => void handleSetupComplete()}
                  onCancel={handleSetupCancel}
                />
              ) : (
                <ResponderAgentRoster
                  value={displayValues}
                  onToggle={(source, enabled) =>
                    void handleToggle(source, enabled)
                  }
                  disabled={!hasGithubIntegration}
                  sourceStates={sourceStates}
                  onSetup={handleSetup}
                  evaluationsUrl={evaluationsUrl}
                />
              )}
            </Box>
          </Tooltip>
        )}
      </Subsection>

      <Subsection
        title="Slack"
        description="Post reports to channels and ping suggested reviewers. Invite PostHog with /invite @PostHog in each channel you use."
      >
        <SlackInboxNotificationsSettings
          isLoading={isLoadingSlack}
          showHeader={false}
          showTopBorder={false}
        />
      </Subsection>

      <Subsection
        title="Auto-start"
        description="Self-driving can start coding tasks automatically when a report is immediately actionable and assigned to you."
      >
        <Flex
          align="center"
          justify="between"
          gap="4"
          className="rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-4 py-3.5"
        >
          <Flex direction="column" gap="1" className="min-w-0">
            <Text className="font-medium text-[13px] text-gray-12">
              Your PR auto-start threshold
            </Text>
            <Text className="max-w-xl text-[12px] text-gray-11 leading-snug">
              Reports at or above this priority can start an implementation task
              for you. The backend deduplicates per report, and these runs count
              toward usage.
            </Text>
          </Flex>
          {userAutonomyConfigLoading ? (
            <Box className="h-8 w-[260px] shrink-0 animate-pulse rounded bg-(--gray-3)" />
          ) : (
            <SettingsOptionSelect
              value={userAutostartPriority}
              options={USER_AUTOSTART_OPTIONS}
              ariaLabel="PR auto-start threshold"
              className="min-w-[260px] max-w-[300px]"
              onValueChange={(value) =>
                void handleUpdateUserAutonomyPriority(
                  value === NEVER_AUTOSTART_VALUE ? null : value,
                )
              }
            />
          )}
        </Flex>
      </Subsection>

      <Subsection
        title="MCP servers"
        description="External tools responders can read from. PostHog data is always available; this is everything else."
      >
        <Link
          to="/mcp-servers"
          className="flex items-center justify-between gap-3 rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-4 py-3.5 no-underline transition-colors duration-150 hover:border-(--gray-6) hover:bg-(--gray-2)"
        >
          <Flex align="center" gap="3" className="min-w-0">
            <PlugsConnectedIcon size={20} className="shrink-0 text-gray-11" />
            <Flex direction="column" gap="0" className="min-w-0">
              <Text className="font-medium text-[13px] text-gray-12">
                Manage MCP servers
              </Text>
              <Text className="text-[12px] text-gray-11 leading-snug">
                Connect or disconnect Notion, PagerDuty, Linear, Zendesk, GitHub
                – anything that speaks MCP.
              </Text>
            </Flex>
          </Flex>
          <ArrowSquareOutIcon size={14} className="shrink-0 text-gray-10" />
        </Link>
      </Subsection>
    </Flex>
  );
}

function SetupTaskSection() {
  const [isStartingSetupTask, setIsStartingSetupTask] = useState(false);
  const {
    repositories,
    getUserIntegrationIdForRepo,
    isLoadingRepos,
    hasGithubIntegration,
  } = useUserRepositoryIntegration();
  const { invalidateTasks } = useCreateTask();
  const taskService = useService<TaskService>(TASK_SERVICE);
  const modelResolver = useService<ReportModelResolver>(REPORT_MODEL_RESOLVER);
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);
  const queryClient = useQueryClient();
  const lastUsedCloudRepository = useSettingsStore(
    (state) => state.lastUsedCloudRepository,
  );

  const setupRepository = useMemo(() => {
    const normalizedLastUsed = lastUsedCloudRepository?.toLowerCase() ?? null;
    if (normalizedLastUsed && repositories.includes(normalizedLastUsed)) {
      return normalizedLastUsed;
    }
    return repositories[0] ?? null;
  }, [lastUsedCloudRepository, repositories]);

  const handleStartSetup = useCallback(async () => {
    if (isStartingSetupTask) return;
    if (isLoadingRepos) {
      toast.error("Still loading GitHub repositories");
      return;
    }
    if (!hasGithubIntegration || !setupRepository) {
      toast.error("Connect GitHub before starting Self-driving setup");
      return;
    }
    if (!cloudRegion) {
      toast.error("Sign in to start Self-driving setup");
      return;
    }

    const githubUserIntegrationId =
      getUserIntegrationIdForRepo(setupRepository);
    if (!githubUserIntegrationId) {
      toast.error("Connect a GitHub integration with repository access");
      return;
    }

    setIsStartingSetupTask(true);
    const toastId = toast.loading(
      "Starting Self-driving setup...",
      setupRepository,
    );

    try {
      const settings = useSettingsStore.getState();
      const adapter = settings.lastUsedAdapter ?? "claude";
      const apiHost = getCloudUrlFromRegion(cloudRegion);
      const model =
        settings.lastUsedModel ??
        (await resolveDefaultModel(
          queryClient,
          apiHost,
          adapter,
          modelResolver,
        ));

      if (!model) {
        sonnerToast.dismiss(toastId);
        toast.error("Failed to start Self-driving setup", {
          description:
            "Couldn't resolve a default model. Open the task page once and pick a model, then try again.",
        });
        return;
      }

      const input: TaskCreationInput = {
        content: AUTONOMY_SETUP_PROMPT,
        taskDescription: AUTONOMY_SETUP_PROMPT,
        repository: setupRepository,
        githubUserIntegrationId,
        workspaceMode: "cloud",
        executionMode: "auto",
        adapter,
        model,
        reasoningLevel: settings.lastUsedReasoningEffort ?? undefined,
      };

      const result = await taskService.createTask(input, (output) => {
        invalidateTasks(output.task);
        void openTask(output.task);
      });

      sonnerToast.dismiss(toastId);
      if (result.success) {
        track(ANALYTICS_EVENTS.TASK_CREATED, {
          auto_run: true,
          created_from: "command-menu",
          repository_provider: "github",
          workspace_mode: "cloud",
          has_branch: false,
          cloud_run_source: "manual",
          adapter,
        });
      } else {
        toast.error("Failed to start Self-driving setup", {
          description: result.error,
        });
        log.error("Self-driving setup task creation failed", {
          failedStep: result.failedStep,
          error: result.error,
          repository: setupRepository,
        });
      }
    } catch (error) {
      sonnerToast.dismiss(toastId);
      const description =
        error instanceof Error ? error.message : "Unknown error";
      toast.error("Failed to start Self-driving setup", { description });
      log.error("Unexpected error during Self-driving setup task creation", {
        error,
        repository: setupRepository,
      });
    } finally {
      setIsStartingSetupTask(false);
    }
  }, [
    cloudRegion,
    getUserIntegrationIdForRepo,
    hasGithubIntegration,
    invalidateTasks,
    isLoadingRepos,
    isStartingSetupTask,
    setupRepository,
    queryClient,
    modelResolver,
    taskService.createTask,
  ]);

  return (
    <Subsection
      title="Setup"
      description="We'll run an agent to inspect your product and figure out what Self-driving should pay attention to first."
    >
      <Flex
        align="center"
        justify="between"
        gap="4"
        className="rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-4 py-3.5"
      >
        <Flex align="start" gap="3" className="min-w-0">
          <span
            className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-(--orange-9) shadow-[0_0_0_3px_var(--orange-3)]"
            aria-hidden
          />
          <Flex direction="column" gap="1.5" className="min-w-0">
            <Flex align="center" gap="2" wrap="wrap">
              <Text className="font-medium text-[13px] text-gray-12">
                Let an agent figure it out
              </Text>
              <Badge color="orange" className="text-[11px]">
                Setup required
              </Badge>
            </Flex>
            <Text className="max-w-xl text-[12.5px] text-gray-11 leading-snug">
              The agent will look at your connected PostHog project and repo,
              choose useful inputs, and tell you what still needs your
              attention.
            </Text>
          </Flex>
        </Flex>
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="shrink-0"
          disabled={isStartingSetupTask || isLoadingRepos}
          onClick={handleStartSetup}
        >
          {isStartingSetupTask ? "Starting..." : "Run setup agent"}
        </Button>
      </Flex>
    </Subsection>
  );
}

interface SubsectionProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

function Subsection({ title, description, children }: SubsectionProps) {
  return (
    <Flex
      direction="column"
      gap="4"
      className="border-(--gray-5) border-t pt-8 first:border-t-0 first:pt-0"
    >
      <Flex direction="column" gap="1">
        <Flex align="center" gap="2" wrap="wrap">
          <Text className="font-semibold text-[13px] text-gray-12">
            {title}
          </Text>
        </Flex>
        {description ? (
          <Text className="max-w-2xl text-[12.5px] text-gray-11 leading-snug">
            {description}
          </Text>
        ) : null}
      </Flex>
      {children}
    </Flex>
  );
}
