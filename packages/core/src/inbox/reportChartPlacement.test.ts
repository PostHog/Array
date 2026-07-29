import { describe, expect, it } from "vitest";
import { layoutReportSummary } from "./reportChartPlacement";

/** Compact view of a layout, so expectations read like the rendered output. */
function render(summary: string, chartIds: string[]): string[] {
  return layoutReportSummary(summary, chartIds).segments.map((segment) =>
    segment.kind === "chart"
      ? `[chart:${segment.chartId}]`
      : segment.content.trim(),
  );
}

describe("layoutReportSummary", () => {
  it("places a chart at the paragraph that references it", () => {
    const summary = [
      "Signups fell over the weekend.",
      "",
      "[Daily signups](chart:signups)",
      "",
      "The drop tracks a deploy on Friday.",
    ].join("\n");

    expect(render(summary, ["signups"])).toEqual([
      "Signups fell over the weekend.",
      "[chart:signups]",
      "The drop tracks a deploy on Friday.",
    ]);
    expect(layoutReportSummary(summary, ["signups"]).placedChartIds).toEqual([
      "signups",
    ]);
  });

  it("places several charts written as one paragraph, in order", () => {
    const summary = "[A](chart:a)\n[B](chart:b)";

    expect(render(summary, ["a", "b"])).toEqual(["[chart:a]", "[chart:b]"]);
  });

  it("places several charts written on one line", () => {
    const summary = "[A](chart:a) [B](chart:b)";

    expect(render(summary, ["a", "b"])).toEqual(["[chart:a]", "[chart:b]"]);
  });

  it("leaves markdown-only summaries untouched", () => {
    const summary = "**What's happening**\n\nNothing to draw here.";

    const layout = layoutReportSummary(summary, []);
    expect(layout.segments).toEqual([{ kind: "markdown", content: summary }]);
    expect(layout.placedChartIds).toEqual([]);
  });

  it.each([
    {
      name: "inside a sentence",
      summary: "Signups fell, see [the chart](chart:a) for detail.",
    },
    {
      name: "in a list item",
      summary: "- [Daily signups](chart:a)",
    },
    {
      name: "in a table cell",
      summary: "| metric |\n| --- |\n| [Daily signups](chart:a) |",
    },
    {
      name: "in a blockquote",
      summary: "> [Daily signups](chart:a)",
    },
    {
      name: "in a fenced code block",
      summary: "```md\n[Daily signups](chart:a)\n```",
    },
    {
      name: "in an indented code block",
      summary: "    [Daily signups](chart:a)",
    },
    {
      name: "sharing a paragraph with prose below it",
      summary: "[Daily signups](chart:a)\nand signups fell.",
    },
    {
      name: "sharing a paragraph with prose above it",
      summary: "Signups fell.\n[Daily signups](chart:a)",
    },
  ])("does not place a reference $name", ({ summary }) => {
    const layout = layoutReportSummary(summary, ["a"]);

    expect(layout.placedChartIds).toEqual([]);
    expect(layout.segments).toEqual([{ kind: "markdown", content: summary }]);
  });

  it("places only the first reference to an id, keeping later labels as text", () => {
    const summary = "[First](chart:a)\n\nProse.\n\n[Again](chart:a)";

    const layout = layoutReportSummary(summary, ["a"]);
    expect(layout.placedChartIds).toEqual(["a"]);
    expect(render(summary, ["a"])).toEqual([
      "[chart:a]",
      "Prose.\n\n[Again](chart:a)",
    ]);
  });

  it("keeps the label of a reference with no matching chart", () => {
    const summary = "[Missing](chart:gone)";

    expect(render(summary, ["a"])).toEqual(["[Missing](chart:gone)"]);
  });

  it("keeps unplaceable labels beside a chart placed on the same line", () => {
    const summary = "[Missing](chart:gone) [Real](chart:a)";

    expect(render(summary, ["a"])).toEqual([
      "[Missing](chart:gone)",
      "[chart:a]",
    ]);
  });

  it("ignores a reference whose id is not a valid chart id", () => {
    const summary = "[Shouty](chart:NOT_VALID)";

    expect(render(summary, ["NOT_VALID"])).toEqual([
      "[Shouty](chart:NOT_VALID)",
    ]);
  });

  it("tolerates a link title and line-break tags around a reference", () => {
    const summary = '[A](chart:a "Daily signups")<br/>';

    expect(render(summary, ["a"])).toEqual(["[chart:a]"]);
  });

  it.each([
    {
      name: "a link-reference definition",
      summary:
        "See [the docs][1].\n\n[Chart](chart:a)\n\n[1]: https://posthog.com",
    },
    {
      name: "a footnote definition",
      summary: "Signups fell[^1].\n\n[Chart](chart:a)\n\n[^1]: Since Friday.",
    },
  ])(
    "skips inline placement when the summary carries $name, keeping the prose whole",
    ({ summary }) => {
      // Definitions resolve document-wide, so splitting would strand them in a
      // separate render pass and the reference would read as literal text.
      const layout = layoutReportSummary(summary, ["a"]);

      expect(layout.placedChartIds).toEqual([]);
      expect(layout.segments).toEqual([{ kind: "markdown", content: summary }]);
    },
  );

  it("reports nothing placed when the summary references no chart", () => {
    const layout = layoutReportSummary("Just prose.", ["a", "b"]);

    expect(layout.placedChartIds).toEqual([]);
  });
});
