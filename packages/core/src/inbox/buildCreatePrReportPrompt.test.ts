import { describe, expect, it } from "vitest";
import { buildCreatePrReportPrompt } from "./reportPrompts";

describe("buildCreatePrReportPrompt", () => {
  it.each([
    { isDevBuild: false, expectedScheme: "posthog-code" },
    { isDevBuild: true, expectedScheme: "posthog-code-dev" },
  ])(
    "uses the $expectedScheme deeplink scheme when isDevBuild=$isDevBuild",
    ({ isDevBuild, expectedScheme }) => {
      const prompt = buildCreatePrReportPrompt({
        reportId: "abc123",
        isDevBuild,
      });
      expect(prompt).toContain(`${expectedScheme}://inbox/abc123`);
    },
  );

  it("references the inbox MCP tools so the agent fetches the detail itself", () => {
    const prompt = buildCreatePrReportPrompt({
      reportId: "abc123",
      isDevBuild: false,
    });
    expect(prompt).toContain("inbox MCP tools");
  });

  it("asks the agent to open a PR", () => {
    const prompt = buildCreatePrReportPrompt({
      reportId: "abc123",
      isDevBuild: false,
    });
    expect(prompt).toMatch(/open a PR/i);
  });

  it("tells the agent to stop rather than guess if the report can't be fetched", () => {
    const prompt = buildCreatePrReportPrompt({
      reportId: "abc123",
      isDevBuild: false,
    });
    expect(prompt).toMatch(/can't fetch the report/i);
    expect(prompt).toMatch(/instead of guessing/i);
  });

  it("appends user feedback when provided", () => {
    const prompt = buildCreatePrReportPrompt({
      reportId: "abc123",
      isDevBuild: false,
      feedback: "Use the v2 endpoint, not v1.",
    });
    expect(prompt).toMatch(/Additional feedback from the user/i);
    expect(prompt).toContain("Use the v2 endpoint, not v1.");
  });

  it.each([
    { label: "undefined", feedback: undefined },
    { label: "empty string", feedback: "" },
    { label: "whitespace only", feedback: "   " },
  ])("omits the feedback section when feedback is $label", ({ feedback }) => {
    const base = buildCreatePrReportPrompt({
      reportId: "abc123",
      isDevBuild: false,
    });
    const prompt = buildCreatePrReportPrompt({
      reportId: "abc123",
      isDevBuild: false,
      feedback,
    });
    expect(prompt).toBe(base);
    expect(prompt).not.toMatch(/Additional feedback/i);
  });
});
