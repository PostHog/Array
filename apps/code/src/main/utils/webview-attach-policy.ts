import { BROWSER_WEBVIEW_PARTITION } from "@shared/browser-view";
import { isAllowedWebviewNavigation } from "./webview-navigation-guard";

interface WebviewSecurityPreferences {
  preload?: string;
  nodeIntegration?: boolean;
  nodeIntegrationInSubFrames?: boolean;
  nodeIntegrationInWorker?: boolean;
  contextIsolation?: boolean;
  sandbox?: boolean;
  webSecurity?: boolean;
  allowRunningInsecureContent?: boolean;
  experimentalFeatures?: boolean;
  enableBlinkFeatures?: string;
  webviewTag?: boolean;
}

export function isAllowedWebviewAttachment(
  params: Record<string, string>,
): boolean {
  return (
    params.partition === BROWSER_WEBVIEW_PARTITION &&
    isAllowedWebviewNavigation(params.src)
  );
}

export function hardenWebviewPreferences(
  preferences: WebviewSecurityPreferences,
): void {
  preferences.preload = undefined;
  preferences.nodeIntegration = false;
  preferences.nodeIntegrationInSubFrames = false;
  preferences.nodeIntegrationInWorker = false;
  preferences.contextIsolation = true;
  preferences.sandbox = true;
  preferences.webSecurity = true;
  preferences.allowRunningInsecureContent = false;
  preferences.experimentalFeatures = false;
  preferences.enableBlinkFeatures = undefined;
  preferences.webviewTag = false;
}
