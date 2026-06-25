import { DEFAULT_GATEWAY_MODEL } from "@posthog/agent/gateway-models";
import { getIsOnline } from "@posthog/core/connectivity/connectivityStore";
import { CloudArtifactService } from "@posthog/core/sessions/cloudArtifactService";
import {
  cloudPromptToBlocks,
  combineQueuedCloudPrompts,
  getCloudPromptTransport,
} from "@posthog/core/sessions/cloudPrompt";
import {
  SessionService,
  type SessionServiceDeps,
} from "@posthog/core/sessions/sessionService";
import { extractSkillButtonId } from "@posthog/core/skill-buttons/prompts";
import { resolveService } from "@posthog/di/container";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";
import {
  createAuthenticatedClient,
  getAuthenticatedClient,
} from "@posthog/ui/features/auth/authClientImperative";
import { fetchAuthState } from "@posthog/ui/features/auth/authQueries";
import { useUsageLimitStore } from "@posthog/ui/features/billing/usageLimitStore";
import { useAddDirectoryDialogStore } from "@posthog/ui/features/folder-picker/addDirectoryDialogStore";
import { NotificationBus } from "@posthog/ui/features/notifications/notifications";
import { useSessionAdapterStore } from "@posthog/ui/features/sessions/sessionAdapterStore";
import {
  getPersistedConfigOptions,
  removePersistedConfigOptions,
  setPersistedConfigOptions,
  updatePersistedConfigOptionValue,
} from "@posthog/ui/features/sessions/sessionConfigStore";
import { sessionStoreSetters } from "@posthog/ui/features/sessions/sessionStore";
import { useSettingsStore } from "@posthog/ui/features/settings/settingsStore";
import { taskViewedApi } from "@posthog/ui/features/sidebar/taskMetaApi";
import { WORKSPACE_QUERY_KEY } from "@posthog/ui/features/workspace/identifiers";
import { toast } from "@posthog/ui/primitives/toast";
import {
  buildPermissionToolMetadata,
  track,
} from "@posthog/ui/shell/posthogAnalyticsImpl";
import { logger } from "../../shell/logger";
import {
  IMPERATIVE_QUERY_CLIENT,
  type ImperativeQueryClient,
} from "../../shell/queryClient";
import { resolveLocalSkillPrompt } from "../message-editor/commands";

export { SessionService };

const log = logger.scope("session-service");

function hostClient(): HostTrpcClient {
  return resolveService<HostTrpcClient>(HOST_TRPC_CLIENT);
}

function buildSessionServiceDeps(): SessionServiceDeps {
  const trpc = hostClient();
  const queryClient = resolveService<ImperativeQueryClient>(
    IMPERATIVE_QUERY_CLIENT,
  );
  const cloudArtifactService = new CloudArtifactService(
    (filePath) => trpc.fs.readFileAsBase64.query({ filePath }),
    (skillBundleRef) => trpc.skills.bundleLocal.query(skillBundleRef),
  );

  return {
    trpc,
    store: sessionStoreSetters,
    log,
    toast: {
      error: (msg, opts) => toast.error(msg, opts),
      info: (msg, opts) => toast.info(msg, opts),
    },
    track: (event, props) => {
      (track as (event: string, props?: Record<string, unknown>) => void)(
        event,
        props,
      );
    },
    buildPermissionToolMetadata,
    notifyPermissionRequest: (taskTitle, taskId) =>
      resolveService(NotificationBus).notifyPermissionRequest(
        taskTitle,
        taskId,
      ),
    notifyPromptComplete: (taskTitle, stopReason, taskId) =>
      resolveService(NotificationBus).notifyPromptComplete(
        taskTitle,
        stopReason,
        taskId,
      ),
    getIsOnline,
    fetchAuthState,
    getAuthenticatedClient,
    createAuthenticatedClient,
    getPersistedConfigOptions: (taskRunId) =>
      getPersistedConfigOptions(taskRunId) ?? undefined,
    setPersistedConfigOptions,
    removePersistedConfigOptions,
    updatePersistedConfigOptionValue,
    adapterStore: {
      getAdapter: (taskRunId) =>
        useSessionAdapterStore.getState().getAdapter(taskRunId),
      setAdapter: (taskRunId, adapter) =>
        useSessionAdapterStore.getState().setAdapter(taskRunId, adapter),
      removeAdapter: (taskRunId) =>
        useSessionAdapterStore.getState().removeAdapter(taskRunId),
    },
    get settings() {
      return useSettingsStore.getState();
    },
    usageLimit: {
      show: (...args) => useUsageLimitStore.getState().show(...args),
    },
    get addDirectoryDialog() {
      return { open: useAddDirectoryDialogStore.getState().open };
    },
    taskViewedApi: {
      markActivity: (taskId) => taskViewedApi.markActivity(taskId),
    },
    queryClient,
    DEFAULT_GATEWAY_MODEL,
    WORKSPACE_QUERY_KEY,
    h: {
      extractSkillButtonId,
      cloudPromptToBlocks,
      combineQueuedCloudPrompts,
      getCloudPromptTransport,
      resolveLocalSkillCommandPrompt: (prompt) =>
        resolveLocalSkillPrompt(prompt, () => trpc.skills.list.query()),
      uploadRunAttachments: (client, taskId, runId, filePaths, skillBundles) =>
        cloudArtifactService.uploadRunAttachments(
          client,
          taskId,
          runId,
          filePaths,
          skillBundles,
        ),
      uploadTaskStagedAttachments: (client, taskId, filePaths, skillBundles) =>
        cloudArtifactService.uploadTaskStagedAttachments(
          client,
          taskId,
          filePaths,
          skillBundles,
        ),
    },
  };
}

// --- Singleton Service Instance ---

let serviceInstance: SessionService | null = null;

export function getSessionService(): SessionService {
  if (!serviceInstance) {
    serviceInstance = new SessionService(buildSessionServiceDeps());
  }
  return serviceInstance;
}

export function resetSessionService(): void {
  if (serviceInstance) {
    serviceInstance.reset();
    serviceInstance = null;
  }

  sessionStoreSetters.clearAll();

  hostClient()
    .agent.resetAll.mutate()
    .catch((err) => {
      log.error("Failed to reset all sessions on main process", err);
    });
}
