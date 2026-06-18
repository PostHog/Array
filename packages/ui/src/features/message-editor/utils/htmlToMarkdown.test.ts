import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "./htmlToMarkdown";

describe("htmlToMarkdown", () => {
  it.each([
    [
      "headings, emphasis and links",
      "<h1>Title</h1><p>Some <strong>bold</strong> and <em>italic</em> with a <a href='https://posthog.com'>link</a>.</p>",
      "# Title\n\nSome **bold** and *italic* with a [link](https://posthog.com).",
    ],
    [
      "unordered lists",
      "<ul><li>one</li><li>two</li></ul>",
      "-   one\n-   two",
    ],
    [
      "tables via the gfm plugin",
      "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |",
    ],
    [
      "fenced code blocks",
      "<pre><code>const x = 1;</code></pre>",
      "```\nconst x = 1;\n```",
    ],
  ])("converts %s", (_, html, expected) => {
    expect(htmlToMarkdown(html)).toBe(expected);
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
