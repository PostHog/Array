import { ArrowSquareOutIcon, PlugsConnectedIcon } from "@phosphor-icons/react";
import {
  REPORT_MODEL_RESOLVER,
  type ReportModelResolver,
} from "@posthog/core/inbox/identifiers";
import { classifyIntegrations } from "@posthog/core/integrations/selectors";
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
import { useTrackAgentsViewed } from "@posthog/ui/features/agents/hooks/useTrackAgentsViewed";
import { useAuthStateValue } from "@posthog/ui/features/auth/store";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { DataSourceSetup } from "@posthog/ui/features/inbox/components/DataSourceSetup";
import {
  ResponderAgentRoster,
  ResponderAgentRosterSkeleton,
} from "@posthog/ui/features/inbox/components/ResponderAgentRoster";
import {
  RESPONDER_AGENT_GROUPS,
  type ResponderAgentSource,
} from "@posthog/ui/features/inbox/components/responderAgentMeta";
import { resolveDefaultModel } from "@posthog/ui/features/inbox/hooks/resolveDefaultModel";
import { useSignalSourceManager } from "@posthog/ui/features/inbox/hooks/useSignalSourceManager";
import {
  useIntegrations,
  useRepositoryIntegration,
  useUserRepositoryIntegration,
} from "@posthog/ui/features/integrations/useIntegrations";
import { ScoutsFleetSection } from "@posthog/ui/features/scouts/components/ScoutsFleetSection";
import { SettingsOptionSelect } from "@posthog/ui/features/settings/SettingsOptionSelect";
import { GitHubIntegrationSection } from "@posthog/ui/features/settings/sections/GitHubIntegrationSection";
import { SlackInboxNotificationsSettings } from "@posthog/ui/features/settings/sections/SlackInboxNotificationsSettings";
import {
  resolveDefaultCloudRepository,
  useSettingsStore,
} from "@posthog/ui/features/settings/settingsStore";
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

/**
 * Source products that count as Responders on this page. `displayValues` also
 * carries the legacy `signals_scout` toggle, but scouts render separately in
 * `ScoutsFleetSection` and are excluded from the responder roster — so they must
 * not inflate the responder counts in `AGENTS_VIEWED`.
 */
const RESPONDER_SOURCE_PRODUCTS = new Set<ResponderAgentSource>(
  RESPONDER_AGENT_GROUPS.flatMap((group) =>
    group.agents.map((agent) => agent.source),
  ),
);

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
  const {
    isLoading: isLoadingSlackIntegrations,
    isError: isIntegrationsError,
    data: integrationsData,
  } = useIntegrations();
  const isLoadingSlack = isLoadingIntegrations || isLoadingSlackIntegrations;
  const showSetupTask = useFeatureFlag(SELF_DRIVING_SETUP_TASK_FLAG);
  const userAutostartPriority =
    userAutonomyConfig?.autostart_priority ?? NEVER_AUTOSTART_VALUE;

  // Derive from the query data, not the store-backed `hasGithubIntegration`: the
  // store is hydrated by a passive effect that lags the query by a render, so the
  // store value can still read `false` on the render where the query settles —
  // exactly when the view event fires. Classifying the query data avoids the lag.
  const trackedHasGithubIntegration = classifyIntegrations(
    integrationsData ?? [],
  ).hasGithubIntegration;
  // Count only Responder sources; `displayValues` also includes `signals_scout`,
  // which renders separately and would otherwise inflate the responder counts.
  const responderEntries = Object.entries(displayValues).filter(([source]) =>
    RESPONDER_SOURCE_PRODUCTS.has(source as ResponderAgentSource),
  );

  useTrackAgentsViewed({
    isLoading: isLoading || isLoadingIntegrations || userAutonomyConfigLoading,
    isError: isIntegrationsError,
    hasGithubIntegration: trackedHasGithubIntegration,
    responderTotalCount: responderEntries.length,
    responderEnabledCount: responderEntries.filter(([, enabled]) => enabled)
      .length,
    autostartPriority: userAutonomyConfig?.autostart_priority ?? null,
    setupTaskAvailable: showSetupTask,
  });

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
        title="Scouts"
        description={
          <>
            Scheduled agents that sweep this project on a cadence and emit
            findings to your inbox.{" "}
            {/* Placeholder docs link until a dedicated scouts page exists. */}
            <a
              href="https://posthog.com/blog/self-driving-product"
              target="_blank"
              rel="noreferrer"
              className="text-accent-11 no-underline hover:text-accent-12"
            >
              Learn more
            </a>
          </>
        }
      >
        <ScoutsFleetSection />
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
              onValueChange={(value) => {
                const priority = value === NEVER_AUTOSTART_VALUE ? null : value;
                track(ANALYTICS_EVENTS.AGENTS_ACTION, {
                  action_type: "change_autostart_priority",
                  autostart_priority: priority,
                });
                void handleUpdateUserAutonomyPriority(priority);
              }}
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
          onClick={() =>
            track(ANALYTICS_EVENTS.AGENTS_ACTION, {
              action_type: "open_mcp_servers",
            })
          }
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

  const setupRepository = useMemo(
    () => resolveDefaultCloudRepository(repositories, lastUsedCloudRepository),
    [lastUsedCloudRepository, repositories],
  );

  const handleStartSetup = useCallback(async () => {
    // A click that fails a precondition is still a failed setup attempt; emit
    // `run_setup_agent` with success:false so these don't drop out of the funnel
    // and bias the success rate upward. (The re-entrancy and still-loading guards
    // below are not attempts, so they don't fire.)
    const trackSetupFailure = () =>
      track(ANALYTICS_EVENTS.AGENTS_ACTION, {
        action_type: "run_setup_agent",
        success: false,
      });

    if (isStartingSetupTask) return;
    if (isLoadingRepos) {
      toast.error("Still loading GitHub repositories");
      return;
    }
    if (!hasGithubIntegration || !setupRepository) {
      trackSetupFailure();
      toast.error("Connect GitHub before starting Self-driving setup");
      return;
    }
    if (!cloudRegion) {
      trackSetupFailure();
      toast.error("Sign in to start Self-driving setup");
      return;
    }

    const githubUserIntegrationId =
      getUserIntegrationIdForRepo(setupRepository);
    if (!githubUserIntegrationId) {
      trackSetupFailure();
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
        trackSetupFailure();
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
      track(ANALYTICS_EVENTS.AGENTS_ACTION, {
        action_type: "run_setup_agent",
        success: result.success,
      });
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
      track(ANALYTICS_EVENTS.AGENTS_ACTION, {
        action_type: "run_setup_agent",
        success: false,
      });
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
