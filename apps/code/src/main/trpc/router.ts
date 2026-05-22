import { additionalDirectoriesRouter } from "./routers/additional-directories";
import { agentRouter } from "./routers/agent";
import { analyticsRouter } from "./routers/analytics";
import { archiveRouter } from "./routers/archive";
import { authRouter } from "./routers/auth";
import { cloudTaskRouter } from "./routers/cloud-task";
import { connectivityRouter } from "./routers/connectivity";
import { contextMenuRouter } from "./routers/context-menu";
import { deepLinkRouter } from "./routers/deep-link";
import { encryptionRouter } from "./routers/encryption";
import { enrichmentRouter } from "./routers/enrichment";
import { environmentRouter } from "./routers/environment";
import { externalAppsRouter } from "./routers/external-apps";
import { fileWatcherRouter } from "./routers/file-watcher";
import { focusRouter } from "./routers/focus";
import { foldersRouter } from "./routers/folders";
import { fsRouter } from "./routers/fs";
import { gitRouter } from "./routers/git";
import { githubIntegrationRouter } from "./routers/github-integration";
import { handoffRouter } from "./routers/handoff";
import { linearIntegrationRouter } from "./routers/linear-integration.js";
import { llmGatewayRouter } from "./routers/llm-gateway";
import { logsRouter } from "./routers/logs";
import { mcpAppsRouter } from "./routers/mcp-apps";
import { mcpCallbackRouter } from "./routers/mcp-callback";
import { notificationRouter } from "./routers/notification";
import { oauthRouter } from "./routers/oauth";
import { osRouter } from "./routers/os";
import { processTrackingRouter } from "./routers/process-tracking";
import { provisioningRouter } from "./routers/provisioning";
import { secureStoreRouter } from "./routers/secure-store";
import { shellRouter } from "./routers/shell";
import { skillsRouter } from "./routers/skills";
import { sleepRouter } from "./routers/sleep";
import { suspensionRouter } from "./routers/suspension.js";
import { uiRouter } from "./routers/ui";
import { updatesRouter } from "./routers/updates";
import { workspaceRouter } from "./routers/workspace";
import { router } from "./trpc";

export const trpcRouter = router({
  additionalDirectories: additionalDirectoriesRouter,
  agent: agentRouter,
  analytics: analyticsRouter,
  archive: archiveRouter,
  auth: authRouter,
  cloudTask: cloudTaskRouter,
  connectivity: connectivityRouter,
  contextMenu: contextMenuRouter,

  enrichment: enrichmentRouter,
  environment: environmentRouter,
  encryption: encryptionRouter,
  externalApps: externalAppsRouter,
  fileWatcher: fileWatcherRouter,
  focus: focusRouter,
  folders: foldersRouter,
  fs: fsRouter,
  git: gitRouter,
  githubIntegration: githubIntegrationRouter,
  handoff: handoffRouter,
  linearIntegration: linearIntegrationRouter,
  llmGateway: llmGatewayRouter,
  mcpApps: mcpAppsRouter,
  mcpCallback: mcpCallbackRouter,
  notification: notificationRouter,
  oauth: oauthRouter,
  logs: logsRouter,
  os: osRouter,
  processTracking: processTrackingRouter,
  provisioning: provisioningRouter,
  sleep: sleepRouter,
  suspension: suspensionRouter,
  secureStore: secureStoreRouter,
  shell: shellRouter,
  skills: skillsRouter,
  ui: uiRouter,
  updates: updatesRouter,
  deepLink: deepLinkRouter,
  workspace: workspaceRouter,
});

export type TrpcRouter = typeof trpcRouter;
