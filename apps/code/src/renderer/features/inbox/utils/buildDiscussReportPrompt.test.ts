import { describe, expect, it } from "vitest";
import { buildDiscussReportPrompt } from "./buildDiscussReportPrompt";

describe("buildDiscussReportPrompt", () => {
  it("uses the production deeplink scheme outside dev builds", () => {
    const prompt = buildDiscussReportPrompt({
      reportId: "abc123",
      isDevBuild: false,
    });
    expect(prompt).toContain("posthog-code://inbox/abc123");
  });

  it("uses the dev deeplink scheme in dev builds", () => {
    const prompt = buildDiscussReportPrompt({
      reportId: "abc123",
      isDevBuild: true,
    });
    expect(prompt).toContain("posthog-code-dev://inbox/abc123");
  });

  it("falls back to the open-ended readout when no question is given", () => {
    const prompt = buildDiscussReportPrompt({
      reportId: "abc123",
      isDevBuild: false,
    });
    expect(prompt).toContain("give me a brief readout");
  });

  it("incorporates a trimmed question when provided", () => {
    const prompt = buildDiscussReportPrompt({
      reportId: "abc123",
      question: "  Why is conversion dropping?  ",
      isDevBuild: false,
    });
    expect(prompt).toContain("answer this first: Why is conversion dropping?");
    expect(prompt).not.toContain("brief readout");
  });

  it("treats a whitespace-only question as no question", () => {
    const prompt = buildDiscussReportPrompt({
      reportId: "abc123",
      question: "   ",
      isDevBuild: false,
    });
    expect(prompt).toContain("brief readout");
  });

  it("appends a slugified title suffix to the deep link", () => {
    const prompt = buildDiscussReportPrompt({
      reportId: "abc123",
      reportTitle: "fix(inbox): Add foo",
      isDevBuild: false,
    });
    expect(prompt).toContain("posthog-code://inbox/abc123/fix-inbox--Add-foo");
  });

  it("omits the slug suffix when the title is blank", () => {
    const prompt = buildDiscussReportPrompt({
      reportId: "abc123",
      reportTitle: "   ",
      isDevBuild: false,
    });
    expect(prompt).toContain("posthog-code://inbox/abc123)");
  });

  it("tells the agent to say so rather than guess if the report can't be fetched", () => {
    const withQuestion = buildDiscussReportPrompt({
      reportId: "abc123",
      question: "Why is conversion dropping?",
      isDevBuild: false,
    });
    const withoutQuestion = buildDiscussReportPrompt({
      reportId: "abc123",
      isDevBuild: false,
    });
    expect(withQuestion).toMatch(/can't fetch the report/i);
    expect(withoutQuestion).toMatch(/can't fetch the report/i);
  });
});
