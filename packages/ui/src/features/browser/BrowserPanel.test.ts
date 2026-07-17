import { describe, expect, it } from "vitest";
import { normalizeAddress } from "./BrowserPanel";

describe("normalizeAddress", () => {
  it.each([
    ["", "about:blank"],
    ["   ", "about:blank"],
    ["about:blank", "about:blank"],
    ["https://posthog.com", "https://posthog.com"],
    ["http://example.com/path", "https://example.com/path"],
    ["http://localhost:3000/path", "http://localhost:3000/path"],
    ["http://127.0.0.2:8000", "http://127.0.0.2:8000"],
    ["http://0.0.0.0:3000", "http://0.0.0.0:3000"],
    ["http://[::1]:3000", "http://[::1]:3000"],
    ["example.com", "https://example.com"],
    ["example.com/path?q=1", "https://example.com/path?q=1"],
    ["localhost:3000", "http://localhost:3000"],
    ["localhost", "http://localhost"],
    ["localhost/dashboard", "http://localhost/dashboard"],
    ["127.0.0.1:8000", "http://127.0.0.1:8000"],
    [
      "how to center a div",
      "https://www.google.com/search?q=how%20to%20center%20a%20div",
    ],
    ["posthog", "https://www.google.com/search?q=posthog"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeAddress(input)).toBe(expected);
  });

  it.each([
    ["file:///etc/passwd", "file%3A%2F%2F%2Fetc%2Fpasswd"],
    ["chrome://settings", "chrome%3A%2F%2Fsettings"],
    [
      "data:text/html,<h1>hi</h1>",
      "data%3Atext%2Fhtml%2C%3Ch1%3Ehi%3C%2Fh1%3E",
    ],
    ["javascript:alert(1)", "javascript%3Aalert(1)"],
  ])("routes disallowed scheme %j to search", (input, encoded) => {
    expect(normalizeAddress(input)).toBe(
      `https://www.google.com/search?q=${encoded}`,
    );
  });
});
