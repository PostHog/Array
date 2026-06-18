import { router } from "@posthog/host-trpc/trpc";
import { additionalDirectoriesRouter } from "./routers/additional-directories.router";
import { agentRouter } from "./routers/agent.router";
import { analyticsRouter } from "./routers/analytics.router";
import { archiveRouter } from "./routers/archive.router";
import { authRouter } from "./routers/auth.router";
import { canvasGenRouter } from "./routers/canvas-gen.router";
import { canvasTemplatesRouter } from "./routers/canvas-templates.router";
import { channelTasksRouter } from "./routers/channel-tasks.router";
import { cloudTaskRouter } from "./routers/cloud-task.router";
import { connectivityRouter } from "./routers/connectivity.router";
import { contextMenuRouter } from "./routers/context-menu.router";
import { dashboardsRouter } from "./routers/dashboards.router";
import { deepLinkRouter } from "./routers/deep-link.router";
import { enrichmentRouter } from "./routers/enrichment.router";
import { environmentRouter } from "./routers/environment.router";
import { externalAppsRouter } from "./routers/external-apps.router";
import { fileWatcherRouter } from "./routers/file-watcher.router";
import { focusRouter } from "./routers/focus.router";
import { foldersRouter } from "./routers/folders.router";
import { fsRouter } from "./routers/fs.router";
import { gitRouter } from "./routers/git.router";
import { githubIntegrationRouter } from "./routers/github-integration.router";
import { handoffRouter } from "./routers/handoff.router";
import { linearIntegrationRouter } from "./routers/linear-integration.router";
import { llmGatewayRouter } from "./routers/llm-gateway.router";
import { logsRouter } from "./routers/logs.router";
import { mcpAppsRouter } from "./routers/mcp-apps.router";
import { mcpCallbackRouter } from "./routers/mcp-callback.router";
import { notificationRouter } from "./routers/notification.router";
import { oauthRouter } from "./routers/oauth.router";
import { onboardingImportRouter } from "./routers/onboarding-import.router";
import { osRouter } from "./routers/os.router";
import { processTrackingRouter } from "./routers/process-tracking.router";
import { provisioningRouter } from "./routers/provisioning.router";
import { secureStoreRouter } from "./routers/secure-store.router";
import { shellRouter } from "./routers/shell.router";
import { skillsRouter } from "./routers/skills.router";
import { slackIntegrationRouter } from "./routers/slack-integration.router";
import { sleepRouter } from "./routers/sleep.router";
import { suspensionRouter } from "./routers/suspension.router";
import { uiRouter } from "./routers/ui.router";
import { updatesRouter } from "./routers/updates.router";
import { usageMonitorRouter } from "./routers/usage-monitor.router";
import { workspaceRouter } from "./routers/workspace.router";

export const hostRouter = router({
  additionalDirectories: additionalDirectoriesRouter,
  agent: agentRouter,
  analytics: analyticsRouter,
  archive: archiveRouter,
  auth: authRouter,
  canvasGen: canvasGenRouter,
  canvasTemplates: canvasTemplatesRouter,
  channelTasks: channelTasksRouter,
  cloudTask: cloudTaskRouter,
  connectivity: connectivityRouter,
  contextMenu: contextMenuRouter,
  dashboards: dashboardsRouter,
  deepLink: deepLinkRouter,
  enrichment: enrichmentRouter,
  environment: environmentRouter,
  externalApps: externalAppsRouter,
  fileWatcher: fileWatcherRouter,
  focus: focusRouter,
  folders: foldersRouter,
  fs: fsRouter,
  git: gitRouter,
  handoff: handoffRouter,
  githubIntegration: githubIntegrationRouter,
  linearIntegration: linearIntegrationRouter,
  llmGateway: llmGatewayRouter,
  logs: logsRouter,
  mcpApps: mcpAppsRouter,
  mcpCallback: mcpCallbackRouter,
  notification: notificationRouter,
  oauth: oauthRouter,
  onboardingImport: onboardingImportRouter,
  os: osRouter,
  processTracking: processTrackingRouter,
  provisioning: provisioningRouter,
  secureStore: secureStoreRouter,
  shell: shellRouter,
  skills: skillsRouter,
  slackIntegration: slackIntegrationRouter,
  sleep: sleepRouter,
  suspension: suspensionRouter,
  ui: uiRouter,
  updates: updatesRouter,
  usageMonitor: usageMonitorRouter,
  workspace: workspaceRouter,
});

export type HostRouter = typeof hostRouter;
