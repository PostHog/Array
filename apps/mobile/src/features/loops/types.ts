import type { LoopSchemas } from "@posthog/api-client/loops";

export type Loop = LoopSchemas.Loop;
export type LoopWrite = LoopSchemas.LoopWrite;
export type PatchedLoop = LoopSchemas.PatchedLoop;
export type PaginatedLoopList = LoopSchemas.PaginatedLoopList;

export type LoopVisibility = LoopSchemas.LoopVisibilityEnum;
export type LoopOverlapPolicy = LoopSchemas.LoopOverlapPolicyEnum;
export type LoopRuntimeAdapter = LoopSchemas.LoopRuntimeAdapterEnum;
export type LoopReasoningEffort = LoopSchemas.LoopReasoningEffortEnum;
export type LoopPosthogMcpScopes = LoopSchemas.LoopPosthogMcpScopesEnum;

export type LoopRepositoryEntry = LoopSchemas.LoopRepositoryEntry;

export type LoopBehaviors = LoopSchemas.LoopBehaviors;
export type LoopBehaviorsWrite = LoopSchemas.LoopBehaviorsWrite;

export type LoopConnectors = LoopSchemas.LoopConnectors;
export type LoopConnectorsWrite = LoopSchemas.LoopConnectorsWrite;

export type LoopNotificationEvent = LoopSchemas.LoopNotificationEventEnum;
export type LoopNotificationChannel = LoopSchemas.LoopNotificationChannel;
export type LoopNotificationChannelWrite =
  LoopSchemas.LoopNotificationChannelWrite;
export type LoopNotifications = LoopSchemas.LoopNotifications;
export type LoopNotificationsWrite = LoopSchemas.LoopNotificationsWrite;

export type LoopTriggerType = LoopSchemas.LoopTriggerTypeEnum;
export type LoopScheduleSyncStatus = LoopSchemas.LoopScheduleSyncStatusEnum;
export type LoopScheduleTriggerConfig = LoopSchemas.LoopScheduleTriggerConfig;
export type LoopGithubTriggerConfig = LoopSchemas.LoopGithubTriggerConfig;
export type LoopGithubTriggerFilters = LoopSchemas.LoopGithubTriggerFilters;
export type LoopGithubTriggerEvent = LoopSchemas.LoopGithubTriggerEventEnum;
export type LoopApiTriggerConfig = LoopSchemas.LoopApiTriggerConfig;
export type LoopTriggerConfig = LoopSchemas.LoopTriggerConfig;
export type LoopTrigger = LoopSchemas.LoopTrigger;
export type LoopTriggerWrite = LoopSchemas.LoopTriggerWrite;

export type LoopRunStatus = LoopSchemas.LoopRunStatusEnum;
export type LoopRunEnvironment = LoopSchemas.LoopRunEnvironmentEnum;
export type LoopRun = LoopSchemas.LoopRun;
export type LoopRunPage = LoopSchemas.LoopRunPage;

export type LoopFireReason = LoopSchemas.LoopFireReasonEnum;
export type LoopFireRun = LoopSchemas.LoopFireRun;

export type LoopPreviewRequest = LoopSchemas.LoopPreviewRequest;
export type LoopPreview = LoopSchemas.LoopPreview;
