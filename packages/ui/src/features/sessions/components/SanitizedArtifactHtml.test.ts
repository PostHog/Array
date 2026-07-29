import { describe, expect, it } from "vitest";
import { sanitizeArtifactHtml } from "./SanitizedArtifactHtml";

describe("sanitizeArtifactHtml", () => {
  it("keeps static document structure and removes executable content", () => {
    const sanitized = sanitizeArtifactHtml(`
      <style>body { background: url(https://example.com/leak) }</style>
      <script>alert(1)</script>
      <h1 onclick="alert(1)" style="color:red">Report</h1>
      <form><input value="secret"></form>
      <p>Safe <strong>content</strong></p>
    `);

    expect(sanitized).toContain("<h1>Report</h1>");
    expect(sanitized).toContain("<strong>content</strong>");
    expect(sanitized).not.toMatch(
      /script|style=|onclick|form|input|background/i,
    );
  });

  it("blocks network-loaded images while retaining safe data images", () => {
    const sanitized = sanitizeArtifactHtml(`
      <img src="https://internal.example/secret" alt="blocked">
      <img src="data:image/png;base64,AAAA" alt="safe">
    `);

    expect(sanitized).toContain('<img alt="blocked">');
    expect(sanitized).toContain('src="data:image/png;base64,AAAA"');
  });

  it("hardens links and strips unsafe protocols", () => {
    const sanitized = sanitizeArtifactHtml(`
      <a href="javascript:alert(1)">bad</a>
      <a href="https://posthog.com">good</a>
    `);

    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).toContain('href="https://posthog.com"');
    expect(sanitized).toContain('rel="noopener noreferrer"');
  });
});
