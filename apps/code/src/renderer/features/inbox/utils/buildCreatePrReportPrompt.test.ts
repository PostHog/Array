import { describe, expect, it } from "vitest";
import { buildCreatePrReportPrompt } from "./buildCreatePrReportPrompt";

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
});
