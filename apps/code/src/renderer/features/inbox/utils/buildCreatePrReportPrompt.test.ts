import { describe, expect, it } from "vitest";
import { buildCreatePrReportPrompt } from "./buildCreatePrReportPrompt";

describe("buildCreatePrReportPrompt", () => {
  it("uses the production deeplink scheme outside dev builds", () => {
    const prompt = buildCreatePrReportPrompt({
      reportId: "abc123",
      isDevBuild: false,
    });
    expect(prompt).toContain("posthog-code://inbox/abc123");
  });

  it("uses the dev deeplink scheme in dev builds", () => {
    const prompt = buildCreatePrReportPrompt({
      reportId: "abc123",
      isDevBuild: true,
    });
    expect(prompt).toContain("posthog-code-dev://inbox/abc123");
  });

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
});
