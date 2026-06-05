import { isSafeExternalUrl } from "@posthog/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openURL = vi.fn((_url: string) => Promise.resolve(true));

vi.mock("react-native", () => ({
  Linking: { openURL: (url: string) => openURL(url) },
}));

import { openExternalUrl } from "./openExternalUrl";

describe("isSafeExternalUrl in the mobile bundle", () => {
  it.each([
    "https://github.com/PostHog/code/pull/42",
    "http://example.com",
    "https://example.com/path?q=1#frag",
    "HTTPS://EXAMPLE.COM",
    "mailto:hi@posthog.com",
  ])("allows %s", (url) => {
    expect(isSafeExternalUrl(url)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,<script>alert(1)</script>",
    "smb://server/share",
    "ms-msdt:/id",
    "vscode://extension",
    "//evil.com",
    "/relative/path",
    "not a url",
    "",
    "   ",
  ])("blocks %s", (url) => {
    expect(isSafeExternalUrl(url)).toBe(false);
  });
});

describe("openExternalUrl", () => {
  beforeEach(() => {
    openURL.mockClear();
  });

  it("opens a safe URL", () => {
    openExternalUrl("https://example.com");
    expect(openURL).toHaveBeenCalledWith("https://example.com");
  });

  it("does not open an unsafe URL", () => {
    openExternalUrl("javascript:alert(1)");
    expect(openURL).not.toHaveBeenCalled();
  });
});
