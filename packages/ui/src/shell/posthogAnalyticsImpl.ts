import posthog from "posthog-js/dist/module.full.no-external";
// Import the recorder to set up __PosthogExtensions__.initSessionRecording
// The module.full.no-external bundle includes rrweb but not the initSessionRecording function
// posthog-recorder (vs lazy-recorder) ensures recording is ready immediately
import "posthog-js/dist/posthog-recorder";
import type {
  EventPropertyMap,
  UserIdentifyProperties,
} from "@posthog/shared/analytics-events";
import type { Task } from "@posthog/shared/domain-types";
import type { FeatureFlags } from "@posthog/ui/features/feature-flags/identifiers";
import type { PermissionRequest } from "@posthog/ui/features/sessions/sessionLogTypes";
import type {
  AnalyticsTracker,
  AnalyticsUserGroups,
} from "@posthog/ui/shell/analytics";
import { logger } from "@posthog/ui/shell/logger";

const log = logger.scope("analytics");

let isInitialized = false;

// Cached so it can be re-applied after posthog.reset() clears super properties.
let registeredAppVersion: string | null = null;

// posthog.reset() wipes super properties, so these are re-registered after each reset.
function registerPersistentSuperProperties() {
  posthog.register({
    team: "posthog-code",
    ...(registeredAppVersion !== null
      ? { app_version: registeredAppVersion }
      : {}),
  });
}

type PendingFlagListener = {
  callback: () => void;
  unsubscribe: (() => void) | null;
};

// Subscribers added before initializePostHog runs.
const pendingFlagListeners = new Set<PendingFlagListener>();

const SESSION_IDLE_TIMEOUT_SECONDS = 36_000;

export function initializePostHog(sessionId?: string) {
  const apiKey = import.meta.env.VITE_POSTHOG_API_KEY;
  const apiHost =
    import.meta.env.VITE_POSTHOG_API_HOST || "https://internal-c.posthog.com";
  const uiHost =
    import.meta.env.VITE_POSTHOG_UI_HOST || "https://us.i.posthog.com";

  if (!apiKey || isInitialized) {
    return;
  }

  posthog.init(apiKey, {
    api_host: apiHost,
    ui_host: uiHost,
    disable_session_recording: false,
    session_idle_timeout_seconds: SESSION_IDLE_TIMEOUT_SECONDS,
    ...(sessionId ? { bootstrap: { sessionID: sessionId } } : {}),
    capture_exceptions: import.meta.env.DEV
      ? false
      : {
          capture_unhandled_errors: true,
          capture_unhandled_rejections: true,
          capture_console_errors: true,
        },
    loaded: () => {
      posthog.startSessionRecording();
    },
  });

  // Clear stale task-scoped super-properties from the previous session.
  posthog.unregister("signal_report_id");

  isInitialized = true;

  registerPersistentSuperProperties();

  for (const listener of pendingFlagListeners) {
    listener.unsubscribe = posthog.onFeatureFlags(listener.callback);
  }
  pendingFlagListeners.clear();
}

/**
 * Log the current session recording status for debugging
 */
export function logSessionRecordingStatus() {
  if (!isInitialized) {
    log.warn("PostHog not initialized");
    return;
  }

  const sessionRecording = posthog.sessionRecording;
  const remoteConfig = posthog.get_property("$session_recording_remote_config");

  log.info("Session Recording Debug:", {
    started: sessionRecording?.started,
    status: sessionRecording?.status,
    remoteConfigEnabled: remoteConfig?.enabled,
    remoteConfig,
    windowLocationHref: window.location?.href,
    configDisableSessionRecording: posthog.config?.disable_session_recording,
  });
}

/**
 * Manually start session recording.
 * Use this to force start recording regardless of triggers.
 */
export function startSessionRecording() {
  if (!isInitialized) {
    return;
  }

  log.info("Attempting to start session recording...");

  // Use PostHog's startSessionRecording API which overrides triggers
  posthog.startSessionRecording();

  // Log status after attempting to start
  setTimeout(() => {
    log.info("Session recording status after manual start:");
    logSessionRecordingStatus();
  }, 1000);
}

// Register the app version as a super property so it rides along on every event.
export function registerAppVersion(appVersion: string) {
  registeredAppVersion = appVersion;

  if (!isInitialized) {
    return;
  }

  posthog.register({ app_version: appVersion });
}

export function identifyUser(
  userId: string,
  properties?: UserIdentifyProperties,
) {
  if (!isInitialized) {
    return;
  }

  posthog.identify(userId, properties);
}

export function setUserGroups(user: AnalyticsUserGroups) {
  if (!isInitialized) {
    return;
  }

  if (user.team) {
    posthog.group("project", user.team.uuid, {
      id: user.team.id,
      uuid: user.team.uuid,
      name: user.team.name,
    });
  }

  if (user.organization) {
    posthog.group("organization", user.organization.id, {
      id: user.organization.id,
      name: user.organization.name,
      slug: user.organization.slug,
    });
  }
}

export function resetUser() {
  if (!isInitialized) {
    return;
  }

  posthog.reset();

  // reset() clears super properties; re-apply the persistent ones.
  registerPersistentSuperProperties();
}

/**
 * Attach (or clear) task-scoped super-properties so every subsequent event
 * carries the context of the currently active task. Pass `null` when no task
 * is active (e.g. when navigating to a non-task view) to clear the context.
 *
 * Currently used to tag every event fired while the user is inside a task
 * launched from an inbox report via the Discuss button.
 */
export function setActiveTaskAnalyticsContext(task: Task | null) {
  if (!isInitialized) {
    return;
  }

  if (task?.signal_report) {
    posthog.register({ signal_report_id: task.signal_report });
  } else {
    posthog.unregister("signal_report_id");
  }
}

export function track<K extends keyof EventPropertyMap>(
  eventName: K,
  ...args: EventPropertyMap[K] extends never
    ? []
    : EventPropertyMap[K] extends undefined
      ? [properties?: EventPropertyMap[K]]
      : [properties: EventPropertyMap[K]]
) {
  if (!isInitialized) {
    return;
  }

  posthog.capture(eventName, args[0]);
}

/**
 * Record a survey response via posthog-js's `survey sent` event. The survey
 * must already exist (and be launched) in the project the app reports to, or
 * the response will not attach to it.
 */
export function captureSurveyResponse({
  surveyId,
  questionId,
  response,
}: {
  surveyId: string;
  questionId: string;
  response: string;
}) {
  if (!isInitialized) {
    return;
  }

  posthog.capture("survey sent", {
    $survey_id: surveyId,
    $survey_questions: [{ id: questionId }],
    // Newer ingestion keys responses by question id; `$survey_response` is the
    // legacy single-question key. Send both so the response attaches either way.
    [`$survey_response_${questionId}`]: response,
    $survey_response: response,
  });
}

/**
 * Build tool metadata for analytics on permission requests
 */
export function buildPermissionToolMetadata(
  permission?: PermissionRequest,
  selectedOptionId?: string,
  customInput?: string,
): Record<string, unknown> {
  const selectedOption = permission?.options?.find(
    (o) => o.optionId === selectedOptionId,
  );
  const rawInput = permission?.toolCall?.rawInput as
    | Record<string, unknown>
    | undefined;

  return {
    tool_name: rawInput?.toolName,
    option_id: selectedOptionId,
    option_kind: selectedOption?.kind ?? "unknown",
    custom_input: customInput,
  };
}

/**
 * Capture an exception for error tracking using PostHog's built-in exception tracking.
 */
export function captureException(
  error: Error,
  additionalProperties?: Record<string, unknown>,
) {
  if (!isInitialized) {
    return;
  }

  posthog.captureException(error, {
    team: "posthog-code",
    ...additionalProperties,
  });
}

// ============================================================================
// Feature Flags
// ============================================================================

/**
 * Check if a feature flag is enabled for the current user.
 * Returns false if PostHog is not initialized or flag is not found.
 */
export function isFeatureFlagEnabled(flagKey: string): boolean {
  if (!isInitialized) {
    return false;
  }

  return posthog.isFeatureEnabled(flagKey) ?? false;
}

/**
 * Subscribe to feature flag changes.
 * Callback is called when flags are loaded or updated.
 * Returns unsubscribe function.
 */
export function onFeatureFlagsLoaded(callback: () => void): () => void {
  if (isInitialized) {
    return posthog.onFeatureFlags(callback);
  }

  const listener: PendingFlagListener = { callback, unsubscribe: null };
  pendingFlagListeners.add(listener);
  return () => {
    if (listener.unsubscribe) {
      listener.unsubscribe();
    } else {
      pendingFlagListeners.delete(listener);
    }
  };
}

/**
 * Reload feature flags from the server.
 * Useful after a person property change (e.g., invite code redemption).
 */
export function reloadFeatureFlags(): void {
  if (!isInitialized) {
    return;
  }

  posthog.reloadFeatureFlags();
}

/**
 * posthog-js implementation of the ANALYTICS_TRACKER port. Bound by the host
 * composition root so packages/ui stays free of any direct posthog access.
 */
export const posthogAnalyticsTracker: AnalyticsTracker = {
  track,
  setActiveTaskContext: setActiveTaskAnalyticsContext,
  captureException,
  identifyUser,
  setUserGroups,
  resetUser,
  captureSurveyResponse,
};

/**
 * posthog-js implementation of the FEATURE_FLAGS port.
 */
export const posthogFeatureFlags: FeatureFlags = {
  isEnabled: isFeatureFlagEnabled,
  onFlagsLoaded: onFeatureFlagsLoaded,
};
