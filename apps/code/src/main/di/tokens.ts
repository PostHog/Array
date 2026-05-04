/**
 * Main process DI tokens.
 *
 * IMPORTANT: These tokens are for main process only.
 * Never import this file from renderer code.
 */
export const MAIN_TOKENS = Object.freeze({
  // Platform ports (host-agnostic interfaces from @posthog/platform)
  UrlLauncher: Symbol.for("Platform.UrlLauncher"),
  StoragePaths: Symbol.for("Platform.StoragePaths"),
  AppMeta: Symbol.for("Platform.AppMeta"),
  Dialog: Symbol.for("Platform.Dialog"),
  Clipboard: Symbol.for("Platform.Clipboard"),
  FileIcon: Symbol.for("Platform.FileIcon"),
  SecureStorage: Symbol.for("Platform.SecureStorage"),
  MainWindow: Symbol.for("Platform.MainWindow"),
  AppLifecycle: Symbol.for("Platform.AppLifecycle"),
  PowerManager: Symbol.for("Platform.PowerManager"),
  Updater: Symbol.for("Platform.Updater"),
  Notifier: Symbol.for("Platform.Notifier"),
  ContextMenu: Symbol.for("Platform.ContextMenu"),
  BundledResources: Symbol.for("Platform.BundledResources"),
  ImageProcessor: Symbol.for("Platform.ImageProcessor"),

  // Stores
  SettingsStore: Symbol.for("Main.SettingsStore"),

  // Database
  AuthPreferenceRepository: Symbol.for("Main.AuthPreferenceRepository"),
  DatabaseService: Symbol.for("Main.DatabaseService"),
  AuthSessionRepository: Symbol.for("Main.AuthSessionRepository"),
  RepositoryRepository: Symbol.for("Main.RepositoryRepository"),
  WorkspaceRepository: Symbol.for("Main.WorkspaceRepository"),
  WorktreeRepository: Symbol.for("Main.WorktreeRepository"),
  ArchiveRepository: Symbol.for("Main.ArchiveRepository"),
  SuspensionRepository: Symbol.for("Main.SuspensionRepository"),
  DefaultAdditionalDirectoryRepository: Symbol.for(
    "Main.DefaultAdditionalDirectoryRepository",
  ),

  // Services
  AgentAuthAdapter: Symbol.for("Main.AgentAuthAdapter"),
  AgentService: Symbol.for("Main.AgentService"),
  AuthService: Symbol.for("Main.AuthService"),
  AuthProxyService: Symbol.for("Main.AuthProxyService"),
  McpProxyService: Symbol.for("Main.McpProxyService"),
  ArchiveService: Symbol.for("Main.ArchiveService"),
  SuspensionService: Symbol.for("Main.SuspensionService"),
  AppLifecycleService: Symbol.for("Main.AppLifecycleService"),
  CloudTaskService: Symbol.for("Main.CloudTaskService"),
  ConnectivityService: Symbol.for("Main.ConnectivityService"),
  ContextMenuService: Symbol.for("Main.ContextMenuService"),

  ExternalAppsService: Symbol.for("Main.ExternalAppsService"),
  LlmGatewayService: Symbol.for("Main.LlmGatewayService"),
  McpAppsService: Symbol.for("Main.McpAppsService"),
  FileWatcherService: Symbol.for("Main.FileWatcherService"),
  FocusService: Symbol.for("Main.FocusService"),
  FocusSyncService: Symbol.for("Main.FocusSyncService"),
  FoldersService: Symbol.for("Main.FoldersService"),
  FsService: Symbol.for("Main.FsService"),
  GitService: Symbol.for("Main.GitService"),
  HandoffService: Symbol.for("Main.HandoffService"),
  GitHubIntegrationService: Symbol.for("Main.GitHubIntegrationService"),
  LinearIntegrationService: Symbol.for("Main.LinearIntegrationService"),
  DeepLinkService: Symbol.for("Main.DeepLinkService"),
  NotificationService: Symbol.for("Main.NotificationService"),
  McpCallbackService: Symbol.for("Main.McpCallbackService"),
  OAuthService: Symbol.for("Main.OAuthService"),
  ProcessTrackingService: Symbol.for("Main.ProcessTrackingService"),
  SleepService: Symbol.for("Main.SleepService"),
  ShellService: Symbol.for("Main.ShellService"),
  PosthogPluginService: Symbol.for("Main.PosthogPluginService"),
  UIService: Symbol.for("Main.UIService"),
  UpdatesService: Symbol.for("Main.UpdatesService"),
  TaskLinkService: Symbol.for("Main.TaskLinkService"),
  InboxLinkService: Symbol.for("Main.InboxLinkService"),
  WatcherRegistryService: Symbol.for("Main.WatcherRegistryService"),
  EnvironmentService: Symbol.for("Main.EnvironmentService"),
  ProvisioningService: Symbol.for("Main.ProvisioningService"),
  WorkspaceService: Symbol.for("Main.WorkspaceService"),
  EnrichmentService: Symbol.for("Main.EnrichmentService"),
});
