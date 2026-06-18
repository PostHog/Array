export const FOCUS_SERVICE = Symbol.for("posthog.workspace.focus-service");
export const FOCUS_SYNC_SERVICE = Symbol.for(
  "posthog.workspace.focus-sync-service",
);
export const GIT_SERVICE = Symbol.for("posthog.workspace.git-service");
export const FS_SERVICE = Symbol.for("posthog.workspace.fs-service");
export const WATCHER_SERVICE = Symbol.for("posthog.workspace.watcher-service");
export const LOCAL_LOGS_SERVICE = Symbol.for(
  "posthog.workspace.local-logs-service",
);
export const CONNECTIVITY_SERVICE = Symbol.for(
  "posthog.workspace.connectivity-service",
);
export const ENVIRONMENT_SERVICE = Symbol.for(
  "posthog.workspace.environment-service",
);

export const TOKENS = Object.freeze({
  FocusService: FOCUS_SERVICE,
  FocusSyncService: FOCUS_SYNC_SERVICE,
  GitService: GIT_SERVICE,
  FsService: FS_SERVICE,
  WatcherService: WATCHER_SERVICE,
  LocalLogsService: LOCAL_LOGS_SERVICE,
  ConnectivityService: CONNECTIVITY_SERVICE,
  EnvironmentService: ENVIRONMENT_SERVICE,
});
