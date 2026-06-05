import { describe, expect, it } from "vitest";
import { isSafeExternalUrl } from "./url";

describe("isSafeExternalUrl", () => {
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
