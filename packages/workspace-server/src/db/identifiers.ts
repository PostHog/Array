export const DATABASE_SERVICE = Symbol.for("posthog.workspace.databaseService");

export const REPOSITORY_REPOSITORY = Symbol.for(
  "posthog.workspace.repositoryRepository",
);
export const WORKSPACE_REPOSITORY = Symbol.for(
  "posthog.workspace.workspaceRepository",
);
export const WORKTREE_REPOSITORY = Symbol.for(
  "posthog.workspace.worktreeRepository",
);
export const ARCHIVE_REPOSITORY = Symbol.for(
  "posthog.workspace.archiveRepository",
);
export const SUSPENSION_REPOSITORY = Symbol.for(
  "posthog.workspace.suspensionRepository",
);
export const AUTH_SESSION_REPOSITORY = Symbol.for(
  "posthog.workspace.authSessionRepository",
);
export const AUTH_PREFERENCE_REPOSITORY = Symbol.for(
  "posthog.workspace.authPreferenceRepository",
);
export const DEFAULT_ADDITIONAL_DIRECTORY_REPOSITORY = Symbol.for(
  "posthog.workspace.defaultAdditionalDirectoryRepository",
);
export const TASK_METADATA_REPOSITORY = Symbol.for(
  "posthog.workspace.taskMetadataRepository",
);
