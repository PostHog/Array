import { describe, expect, it } from "vitest";
import {
  isAllowedWebviewNavigation,
  isAllowedWebviewRequest,
  isBlockedWebviewHost,
} from "./webview-navigation-guard";

describe("isBlockedWebviewHost", () => {
  it.each([
    ["169.254.169.254", true],
    ["169.254.0.1", true],
    // WHATWG URL folds decimal/hex IPv4 to dotted form before this runs.
    [new URL("http://2852039166/").hostname, true],
    // IPv6-mapped IPv4: OS still connects to the v4 metadata service.
    [new URL("http://[::ffff:169.254.169.254]/").hostname, true],
    ["metadata.google.internal", true],
    ["METADATA.GOOGLE.INTERNAL", true],
    ["localhost", false],
    ["127.0.0.1", false],
    ["192.168.1.5", false],
    ["posthog.com", false],
    // Not the metadata address — a normal 169.253.x host is allowed.
    ["169.253.1.1", false],
  ])("host %j -> blocked %s", (hostname, blocked) => {
    expect(isBlockedWebviewHost(hostname)).toBe(blocked);
  });
});

describe("isAllowedWebviewRequest", () => {
  it.each([
    ["https://posthog.com", "mainFrame", true],
    ["http://posthog.com", "mainFrame", false],
    ["https://posthog.com/app.js", "script", true],
    ["http://localhost:3000/app.js", "script", true],
    ["http://posthog.com/app.js", "script", false],
    ["data:image/png;base64,AA==", "image", true],
    ["blob:https://posthog.com/id", "xhr", true],
    ["about:blank", "subFrame", true],
    ["about:srcdoc", "subFrame", false],
    ["file:///etc/passwd", "xhr", false],
    ["custom-scheme://host/path", "xhr", false],
    ["http://169.254.169.254/latest/meta-data/", "xhr", false],
  ])("url %j resource %j -> allowed %s", (url, resourceType, allowed) => {
    expect(isAllowedWebviewRequest(url, resourceType)).toBe(allowed);
  });
});

describe("isAllowedWebviewNavigation", () => {
  it.each([
    ["https://posthog.com", true],
    ["http://localhost:3000", true],
    ["http://127.0.0.2:3000", true],
    ["http://0.0.0.0:3000", true],
    ["http://[::1]:3000", true],
    ["http://posthog.com", false],
    ["http://192.168.1.5", false],
    ["about:blank", true],
    ["about:srcdoc", false],
    ["about:config", false],
    // Blocked schemes fall through to search in the renderer; the guard vetoes.
    ["file:///etc/passwd", false],
    ["chrome://settings", false],
    ["javascript:alert(1)", false],
    ["data:text/html,<h1>hi</h1>", false],
    // Metadata endpoint over an allowed scheme is still blocked by host.
    ["http://169.254.169.254/latest/meta-data/", false],
    ["http://metadata.google.internal/computeMetadata/v1/", false],
    ["not a url", false],
  ])("url %j -> allowed %s", (url, allowed) => {
    expect(isAllowedWebviewNavigation(url)).toBe(allowed);
  });
});
