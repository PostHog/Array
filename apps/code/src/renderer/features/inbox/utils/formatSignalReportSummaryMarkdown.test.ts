import { describe, expect, it } from "vitest";
import { formatSignalReportSummaryMarkdown } from "./formatSignalReportSummaryMarkdown";

describe("formatSignalReportSummaryMarkdown", () => {
  it("puts section body text on a new line after the header", () => {
    const input =
      "**What's happening:** Error tracking issue keyed on `app:dashboard_query`.";
    expect(formatSignalReportSummaryMarkdown(input)).toBe(
      "**What's happening:**\n\nError tracking issue keyed on `app:dashboard_query`.",
    );
  });

  it("separates consecutive section headers onto their own lines", () => {
    const input =
      "**What's happening:** Users hit rate limits. **Root cause:** All four rate limiters are contended. **How to resolve:** Reduce blocking.";
    expect(formatSignalReportSummaryMarkdown(input)).toBe(
      "**What's happening:**\n\nUsers hit rate limits.\n\n**Root cause:**\n\nAll four rate limiters are contended.\n\n**How to resolve:**\n\nReduce blocking.",
    );
  });

  it("separates a section header from preceding intro text", () => {
    const input =
      "Users on busy orgs are hitting hard limits. **What's happening:** Error tracking issue.";
    expect(formatSignalReportSummaryMarkdown(input)).toBe(
      "Users on busy orgs are hitting hard limits.\n\n**What's happening:**\n\nError tracking issue.",
    );
  });

  it("leaves content without section headers unchanged", () => {
    const input = "Plain summary with no structured sections.";
    expect(formatSignalReportSummaryMarkdown(input)).toBe(input);
  });
});
