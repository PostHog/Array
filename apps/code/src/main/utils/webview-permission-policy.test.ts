import { describe, expect, it } from "vitest";
import { isAllowedWebviewPermission } from "./webview-permission-policy";

describe("isAllowedWebviewPermission", () => {
  it.each([
    "clipboard-read",
    "media",
    "geolocation",
    "notifications",
    "openExternal",
    "future-electron-permission",
  ])("denies %s", (permission) => {
    expect(isAllowedWebviewPermission(permission)).toBe(false);
  });
});
