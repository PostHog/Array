import { BROWSER_WEBVIEW_PARTITION } from "@posthog/shared/constants";
import { describe, expect, it } from "vitest";
import {
  hardenWebviewPreferences,
  isAllowedWebviewAttachment,
} from "./webview-attach-policy";

describe("isAllowedWebviewAttachment", () => {
  it.each([
    ["https://posthog.com", BROWSER_WEBVIEW_PARTITION, true],
    ["about:blank", BROWSER_WEBVIEW_PARTITION, true],
    ["http://localhost:3000", BROWSER_WEBVIEW_PARTITION, true],
    ["file:///etc/passwd", BROWSER_WEBVIEW_PARTITION, false],
    ["https://posthog.com", "persist:attacker", false],
    ["https://posthog.com", "", false],
  ])("src %j partition %j -> allowed %s", (src, partition, allowed) => {
    expect(isAllowedWebviewAttachment({ src, partition })).toBe(allowed);
  });
});

describe("hardenWebviewPreferences", () => {
  it("overrides security-sensitive guest preferences", () => {
    const preferences = {
      preload: "/tmp/attacker.js",
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      nodeIntegrationInWorker: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      experimentalFeatures: true,
      enableBlinkFeatures: "Serial",
      webviewTag: true,
    };

    hardenWebviewPreferences(preferences);

    expect(preferences).toEqual({
      preload: undefined,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      enableBlinkFeatures: undefined,
      webviewTag: false,
    });
  });
});
