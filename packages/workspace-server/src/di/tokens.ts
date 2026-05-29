export const TOKENS = Object.freeze({
  FocusService: Symbol.for("posthog.workspace.focus-service"),
  FocusSyncService: Symbol.for("posthog.workspace.focus-sync-service"),
  GitService: Symbol.for("posthog.workspace.git-service"),
  FsService: Symbol.for("posthog.workspace.fs-service"),
  WatcherService: Symbol.for("posthog.workspace.watcher-service"),
  LocalLogsService: Symbol.for("posthog.workspace.local-logs-service"),
  ConnectivityService: Symbol.for("posthog.workspace.connectivity-service"),
  EnvironmentService: Symbol.for("posthog.workspace.environment-service"),
});
