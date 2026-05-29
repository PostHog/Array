/**
 * Main process DI tokens.
 *
 * IMPORTANT: These tokens are for main process only.
 * Never import this file from renderer code.
 */
export const MAIN_TOKENS = Object.freeze({
  // Workspace-server connection (typed client over the ELECTRON_RUN_AS_NODE child)
  WorkspaceClient: Symbol.for("posthog.host.main.workspace.client"),

  // Stores
  SettingsStore: Symbol.for("posthog.host.main.settings.store"),
  SecureStoreService: Symbol.for("posthog.host.main.secure-store.service"),
  SecureStoreBackend: Symbol.for("posthog.host.main.secure-store.backend"),
  EncryptionService: Symbol.for("posthog.host.main.encryption.service"),

  // Database
  AuthPreferenceRepository: Symbol.for(
    "posthog.host.main.auth.preference-repository",
  ),
  DatabaseService: Symbol.for("posthog.host.main.database.service"),
  AuthSessionRepository: Symbol.for(
    "posthog.host.main.auth.session-repository",
  ),
  RepositoryRepository: Symbol.for("posthog.host.main.repository.repository"),
  WorkspaceRepository: Symbol.for("posthog.host.main.workspace.repository"),
  WorktreeRepository: Symbol.for("posthog.host.main.worktree.repository"),
  ArchiveRepository: Symbol.for("posthog.host.main.archive.repository"),
  SuspensionRepository: Symbol.for("posthog.host.main.suspension.repository"),
  DefaultAdditionalDirectoryRepository: Symbol.for(
    "posthog.host.main.additional-directory.default-repository",
  ),

  // Services
  AuthService: Symbol.for("posthog.host.main.auth.service"),
  SuspensionService: Symbol.for("posthog.host.main.suspension.service"),
  AppLifecycleService: Symbol.for("posthog.host.main.app-lifecycle.service"),
  CloudTaskService: Symbol.for("posthog.host.main.cloud-task.service"),
  ContextMenuService: Symbol.for("posthog.host.main.context-menu.service"),

  ExternalAppsService: Symbol.for("posthog.host.main.external-apps.service"),
  LlmGatewayService: Symbol.for("posthog.host.main.llm-gateway.service"),
  McpAppsService: Symbol.for("posthog.host.main.mcp-apps.service"),
  FileWatcherService: Symbol.for("posthog.host.main.file-watcher.service"),
  FsService: Symbol.for("posthog.host.main.fs.service"),
  GitService: Symbol.for("posthog.host.main.git.service"),
  DeepLinkService: Symbol.for("posthog.host.main.deep-link.service"),
  ProcessTrackingService: Symbol.for(
    "posthog.host.main.process-tracking.service",
  ),
  SleepService: Symbol.for("posthog.host.main.sleep.service"),
  PosthogPluginService: Symbol.for("posthog.host.main.posthog-plugin.service"),
  UpdatesService: Symbol.for("posthog.host.main.updates.service"),
  TaskLinkService: Symbol.for("posthog.host.main.task-link.service"),
  InboxLinkService: Symbol.for("posthog.host.main.inbox-link.service"),
  NewTaskLinkService: Symbol.for("posthog.host.main.new-task-link.service"),
  WatcherRegistryService: Symbol.for(
    "posthog.host.main.watcher-registry.service",
  ),
  ProvisioningService: Symbol.for("posthog.host.main.provisioning.service"),
  WorkspaceService: Symbol.for("posthog.host.main.workspace.service"),
  WorkspaceServerService: Symbol.for(
    "posthog.host.main.workspace-server.service",
  ),
});
