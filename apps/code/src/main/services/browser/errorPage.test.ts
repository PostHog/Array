import { describe, expect, it } from "vitest";
import { buildErrorPage } from "./errorPage";

describe("buildErrorPage", () => {
  it("returns a data: URI", () => {
    const result = buildErrorPage("https://example.com");
    expect(result).toMatch(/^data:text\/html;charset=utf-8,/);
  });

  it("encodes the failed URL into the page", () => {
    const url = "https://example.com/path?q=test";
    const result = buildErrorPage(url);
    const decoded = decodeURIComponent(
      result.replace("data:text/html;charset=utf-8,", ""),
    );
    expect(decoded).toContain(url);
  });

  it("produces valid HTML with PostHog branding", () => {
    const decoded = decodeURIComponent(
      buildErrorPage("https://example.com").replace(
        "data:text/html;charset=utf-8,",
        "",
      ),
    );
    expect(decoded).toContain("<!DOCTYPE html>");
    expect(decoded).toContain("PostHog");
  });

  it("handles empty URL without throwing", () => {
    expect(() => buildErrorPage("")).not.toThrow();
  });
});
