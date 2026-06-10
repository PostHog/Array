import { describe, expect, it } from "vitest";
import { buildCreatePrReportPrompt } from "./buildCreatePrReportPrompt";

describe("buildCreatePrReportPrompt", () => {
  it("returns the base prompt unchanged when no feedback is given", () => {
    const prompt = buildCreatePrReportPrompt({ summary: "A summary" });
    expect(prompt).toBe(
      "Act on this signal report. Investigate the root cause, implement the fix, and open a PR if appropriate.\n\nA summary",
    );
  });

  it("appends a feedback section when feedback is provided", () => {
    const prompt = buildCreatePrReportPrompt({
      summary: "A summary",
      feedback: "Use the staging database",
    });
    expect(prompt).toContain(
      "Additional feedback from the user (take this into account, including any questions raised in the report thread):\nUse the staging database",
    );
  });

  it("trims feedback before appending it", () => {
    const prompt = buildCreatePrReportPrompt({
      summary: "A summary",
      feedback: "  Use the staging database  ",
    });
    expect(prompt).toContain(":\nUse the staging database");
    expect(prompt.endsWith("Use the staging database")).toBe(true);
  });

  it("treats whitespace-only feedback as no feedback", () => {
    const base = buildCreatePrReportPrompt({ summary: "A summary" });
    const prompt = buildCreatePrReportPrompt({
      summary: "A summary",
      feedback: "   ",
    });
    expect(prompt).toBe(base);
  });

  it("tolerates a missing summary", () => {
    const prompt = buildCreatePrReportPrompt({});
    expect(prompt).toBe(
      "Act on this signal report. Investigate the root cause, implement the fix, and open a PR if appropriate.\n\n",
    );
  });
});
