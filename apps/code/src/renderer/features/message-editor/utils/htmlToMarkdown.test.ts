import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "./htmlToMarkdown";

describe("htmlToMarkdown", () => {
  it("converts headings, emphasis and links", () => {
    const html =
      "<h1>Title</h1><p>Some <strong>bold</strong> and <em>italic</em> with a <a href='https://posthog.com'>link</a>.</p>";
    expect(htmlToMarkdown(html)).toBe(
      "# Title\n\nSome **bold** and *italic* with a [link](https://posthog.com).",
    );
  });

  it("converts unordered lists", () => {
    const html = "<ul><li>one</li><li>two</li></ul>";
    expect(htmlToMarkdown(html)).toBe("-   one\n-   two");
  });

  it("converts tables via the gfm plugin", () => {
    const html =
      "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>";
    expect(htmlToMarkdown(html)).toBe(
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |",
    );
  });

  it("converts fenced code blocks", () => {
    const html = "<pre><code>const x = 1;</code></pre>";
    expect(htmlToMarkdown(html)).toBe("```\nconst x = 1;\n```");
  });

  it("returns null when there is no formatting beyond the plain-text fallback", () => {
    const html = "<p>just text</p>";
    expect(htmlToMarkdown(html, "just text")).toBeNull();
  });

  it("returns null for empty html", () => {
    expect(htmlToMarkdown("")).toBeNull();
    expect(htmlToMarkdown("<p></p>")).toBeNull();
  });
});
