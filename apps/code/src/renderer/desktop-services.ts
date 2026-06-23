// Desktop host service bindings live here as features move into packages.
// Importing the renderer container performs today's existing bindings.
import "@renderer/di/container";
import {
  setPosthogApiClientAppVersion,
  setPosthogApiClientLogger,
} from "@posthog/api-client/posthog-client";
import { archiveModule } from "@posthog/core/archive/archive.module";
import {
  ARCHIVE_CLIENT,
  type ArchiveClient,
} from "@posthog/core/archive/identifiers";
import {
  LINEAR_OAUTH_FLOW,
  type LinearOAuthFlow,
  REPORT_MODEL_RESOLVER,
  type ReportModelResolver,
} from "@posthog/core/inbox/identifiers";
import { selectModelFromOptions } from "@posthog/core/inbox/reportTaskCreation";
import {
  GITHUB_CONNECT_CLIENT as INTEGRATIONS_GITHUB_CONNECT_CLIENT,
  type GithubConnectClient as IntegrationsGithubConnectClient,
  REPOSITORIES_CLIENT,
  REPOSITORIES_SERVICE,
  type RepositoriesClient,
} from "@posthog/core/integrations/identifiers";
import { RepositoriesService } from "@posthog/core/integrations/repositoriesService";
import {
  GITHUB_CONNECT_CLIENT,
  type GithubConnectClient,
} from "@posthog/core/onboarding/identifiers";
import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import { SETUP_STORE } from "@posthog/core/setup/identifiers";
import { resolveService } from "@posthog/di/container";
import { ROOT_LOGGER, type RootLogger } from "@posthog/di/logger";
import {
  type INotifications,
  NOTIFICATIONS_SERVICE,
} from "@posthog/platform/notifications";
import type { CloudRegion } from "@posthog/shared";
import {
  AUTH_SIDE_EFFECTS,
  type IAuthSideEffects,
} from "@posthog/ui/features/auth/identifiers";
import {
  FEATURE_FLAGS,
  type FeatureFlags,
} from "@posthog/ui/features/feature-flags/identifiers";
import {
  FILE_WATCHER_CLIENT,
  type FileWatcherClient,
} from "@posthog/ui/features/file-watcher/identifiers";
import { GIT_CACHE_KEY_PROVIDER } from "@posthog/ui/features/git-interaction/gitCacheProvider";
import {
  UiGithubConnectClient,
  UiRepositoriesClient,
} from "@posthog/ui/features/integrations/integrationsClientImpl";
import { NAVIGATION_TASK_BINDER } from "@posthog/ui/features/navigation/taskBinder";
import { navigationTaskBinder } from "@posthog/ui/features/navigation/taskBinderImpl";
import {
  ACTIVE_VIEW_PROVIDER,
  type IActiveView,
  type INotificationSettings,
  NOTIFICATION_SETTINGS_PROVIDER,
} from "@posthog/ui/features/notifications/identifiers";
import { OnboardingGithubConnectClient } from "@posthog/ui/features/onboarding/githubConnectClientImpl";
import {
  AGENT_PROMPT_SENDER,
  type AgentPromptSender,
} from "@posthog/ui/features/sessions/agentPromptSender";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { getAppViewSnapshot } from "@posthog/ui/router/useAppView";
import { HEDGEHOG_MODE_HOST } from "@posthog/ui/shell/hedgehogModeHost";
import { posthogFeatureFlags } from "@posthog/ui/shell/posthogAnalyticsImpl";
import { IMPERATIVE_QUERY_CLIENT } from "@posthog/ui/shell/queryClient";
import {
  FILE_PATH_RESOLVER,
  type FilePathResolver,
} from "@posthog/ui/utils/getFilePath";
import { container } from "@renderer/di/container";
import { RendererAuthSideEffects } from "@renderer/platform-adapters/auth-side-effects";
import { gitCacheKeyProvider } from "@renderer/platform-adapters/git-cache-keys";
import { RendererHedgehogModeHost } from "@renderer/platform-adapters/hedgehog-mode-host";
import { setupStore } from "@renderer/platform-adapters/setup";
import { initTours } from "@renderer/platform-adapters/tour";
import { hostTrpcClient, trpcClient } from "@renderer/trpc/client";
import { logger } from "@utils/logger";
import { queryClient } from "@utils/queryClient";

container.bind(IMPERATIVE_QUERY_CLIENT).toConstantValue(queryClient);
container.bind(GIT_CACHE_KEY_PROVIDER).toConstantValue(gitCacheKeyProvider);

// archive
container.load(archiveModule);
container.bind(ARCHIVE_CLIENT).toConstantValue({
  unarchive: (input) => hostTrpcClient.archive.unarchive.mutate(input),
  delete: (input) => hostTrpcClient.archive.delete.mutate(input),
  showArchivedTaskContextMenu: (input) =>
    hostTrpcClient.contextMenu.showArchivedTaskContextMenu.mutate(input),
} satisfies ArchiveClient);

// inbox host capabilities
const reportModelResolverLog = logger.scope("report-model-resolver");
container.bind<ReportModelResolver>(REPORT_MODEL_RESOLVER).toConstantValue({
  async resolveDefaultModel(
    apiHost: string,
    adapter: "claude" | "codex",
    preferredModel?: string | null,
  ): Promise<string | undefined> {
    try {
      const options = await hostTrpcClient.agent.getPreviewConfigOptions.query({
        apiHost,
        adapter,
      });
      return selectModelFromOptions(options, preferredModel);
    } catch (error) {
      reportModelResolverLog.warn("Failed to resolve default model", {
        error,
        adapter,
      });
      return undefined;
    }
  },
});
container.bind(LINEAR_OAUTH_FLOW).toConstantValue({
  startFlow: async (region: string, projectId: number) => {
    await hostTrpcClient.linearIntegration.startFlow.mutate({
      region: region as CloudRegion,
      projectId,
    });
  },
} satisfies LinearOAuthFlow);

// onboarding
container
  .bind<GithubConnectClient>(GITHUB_CONNECT_CLIENT)
  .toConstantValue(new OnboardingGithubConnectClient());

// integrations
container
  .bind<IntegrationsGithubConnectClient>(INTEGRATIONS_GITHUB_CONNECT_CLIENT)
  .toConstantValue(new UiGithubConnectClient());
container
  .bind<RepositoriesClient>(REPOSITORIES_CLIENT)
  .toConstantValue(new UiRepositoriesClient());
container.bind(REPOSITORIES_SERVICE).to(RepositoriesService).inSingletonScope();

container
  .bind(HEDGEHOG_MODE_HOST)
  .toConstantValue(new RendererHedgehogModeHost());
container
  .bind<AgentPromptSender>(AGENT_PROMPT_SENDER)
  .toConstantValue(async (taskId, prompt) => {
    await resolveService<SessionService>(SESSION_SERVICE).sendPrompt(
      taskId,
      prompt,
    );
  });
container.bind<FilePathResolver>(FILE_PATH_RESOLVER).toConstantValue({
  resolve: (file) => window.electronUtils?.getPathForFile?.(file),
});
container.bind(NAVIGATION_TASK_BINDER).toConstantValue(navigationTaskBinder);
initTours();
setPosthogApiClientLogger(logger.scope("posthog-client"));
setPosthogApiClientAppVersion(
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown",
);

container.bind<RootLogger>(ROOT_LOGGER).toConstantValue(logger);

const notificationsLog = logger.scope("notifications-adapter");
container.bind<INotifications>(NOTIFICATIONS_SERVICE).toConstantValue({
  notify: (options) => {
    hostTrpcClient.notification.send.mutate(options).catch((err) => {
      notificationsLog.error("Failed to send notification", err);
    });
  },
  showUnreadIndicator: () => {
    hostTrpcClient.notification.showDockBadge.mutate().catch((err) => {
      notificationsLog.error("Failed to show unread indicator", err);
    });
  },
  requestAttention: () => {
    hostTrpcClient.notification.bounceDock.mutate().catch((err) => {
      notificationsLog.error("Failed to request attention", err);
    });
  },
});

container
  .bind<INotificationSettings>(NOTIFICATION_SETTINGS_PROVIDER)
  .toConstantValue({
    get: () => {
      const s = useSettingsStore.getState();
      return {
        desktopNotifications: s.desktopNotifications,
        dockBadgeNotifications: s.dockBadgeNotifications,
        dockBounceNotifications: s.dockBounceNotifications,
        completionSound: s.completionSound,
        completionVolume: s.completionVolume,
      };
    },
  });

container.bind<IActiveView>(ACTIVE_VIEW_PROVIDER).toConstantValue({
  hasFocus: () => document.hasFocus(),
  getActiveTaskId: () => {
    const view = getAppViewSnapshot();
    return view.type === "task-detail" ? view.taskId : undefined;
  },
});

container.bind<FileWatcherClient>(FILE_WATCHER_CLIENT).toConstantValue({
  start: (repoPath: string) =>
    trpcClient.fileWatcher.start.mutate({ repoPath }),
  stop: (repoPath: string) => trpcClient.fileWatcher.stop.mutate({ repoPath }),
});

container
  .bind<FeatureFlags>(FEATURE_FLAGS)
  .toConstantValue(posthogFeatureFlags);

container
  .bind<IAuthSideEffects>(AUTH_SIDE_EFFECTS)
  .to(RendererAuthSideEffects)
  .inSingletonScope();

container.bind(SETUP_STORE).toConstantValue(setupStore);
