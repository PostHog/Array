import { describe, expect, it } from "vitest";
import { buildHtmlArtifactDocument } from "./htmlSandbox";

const CSP_MARKER = '<meta http-equiv="Content-Security-Policy"';

describe("buildHtmlArtifactDocument", () => {
  it("injects the CSP after <head> and the shim before </body>", () => {
    const html =
      "<!doctype html><html><head><title>R</title></head><body><p>hi</p></body></html>";
    const doc = buildHtmlArtifactDocument(html);
    expect(doc.indexOf(CSP_MARKER)).toBe(
      doc.indexOf("<head>") + "<head>".length,
    );
    const shimAt = doc.indexOf("<script>");
    expect(shimAt).toBeGreaterThan(doc.indexOf("<p>hi</p>"));
    expect(doc.indexOf("</body>")).toBeGreaterThan(shimAt);
  });

  it("handles case-insensitive tags and head attributes", () => {
    const html =
      '<HTML><HEAD lang="en"><TITLE>R</TITLE></HEAD><BODY>x</BODY></HTML>';
    const doc = buildHtmlArtifactDocument(html);
    expect(doc.indexOf(CSP_MARKER)).toBe(
      doc.indexOf('<HEAD lang="en">') + '<HEAD lang="en">'.length,
    );
    expect(doc.indexOf("<script>")).toBeLessThan(doc.indexOf("</BODY>"));
  });

  it("creates a head when only <html> exists and appends the shim without </body>", () => {
    const doc = buildHtmlArtifactDocument("<html><p>frag</p></html>");
    expect(doc).toContain(`<html><head>${CSP_MARKER}`);
    expect(doc.endsWith("</script>")).toBe(true);
  });

  it("prepends the CSP to a bare fragment", () => {
    const doc = buildHtmlArtifactDocument("<p>frag</p>");
    expect(doc.startsWith(CSP_MARKER)).toBe(true);
    expect(doc.endsWith("</script>")).toBe(true);
  });

  it("injects before the LAST </body> so an inline code sample can't hijack placement", () => {
    const html =
      "<html><head></head><body><pre>&lt;/body&gt;</pre><p>real</p></body></html>";
    const doc = buildHtmlArtifactDocument(html);
    const shimAt = doc.indexOf("<script>");
    expect(shimAt).toBeGreaterThan(doc.indexOf("<p>real</p>"));
  });

  it("leaves the artifact bytes otherwise untouched", () => {
    const html =
      '<!doctype html><html><head><meta charset="utf-8"></head><body><p>précis &amp; more</p></body></html>';
    const doc = buildHtmlArtifactDocument(html);
    const stripped = doc
      .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, "")
      .replace(/<script>[\s\S]*<\/script>/, "");
    expect(stripped).toBe(html);
  });

  it("locks down network access in the CSP", () => {
    const doc = buildHtmlArtifactDocument("<html><body>x</body></html>");
    const csp = doc.match(/content="([^"]+)"/)?.[1] ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'unsafe-inline'");
    expect(csp).not.toContain("connect-src");
  });
});
