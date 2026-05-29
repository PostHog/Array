import { describe, expect, it } from "vitest";
import { formatSignalReportSummaryMarkdown } from "./formatSignalReportSummaryMarkdown";

describe("formatSignalReportSummaryMarkdown", () => {
  it.each([
    {
      name: "puts section body text on a new line after the header",
      input:
        "**What's happening:** Error tracking issue keyed on `app:dashboard_query`.",
      expected:
        "**What's happening:**\n\nError tracking issue keyed on `app:dashboard_query`.",
    },
    {
      name: "separates consecutive section headers onto their own lines",
      input:
        "**What's happening:** Users hit rate limits. **Root cause:** All four rate limiters are contended. **How to resolve:** Reduce blocking.",
      expected:
        "**What's happening:**\n\nUsers hit rate limits.\n\n**Root cause:**\n\nAll four rate limiters are contended.\n\n**How to resolve:**\n\nReduce blocking.",
    },
    {
      name: "separates a section header from preceding intro text",
      input:
        "Users on busy orgs are hitting hard limits. **What's happening:** Error tracking issue.",
      expected:
        "Users on busy orgs are hitting hard limits.\n\n**What's happening:**\n\nError tracking issue.",
    },
    {
      name: "leaves content without section headers unchanged",
      input: "Plain summary with no structured sections.",
      expected: "Plain summary with no structured sections.",
    },
  ])("$name", ({ input, expected }) => {
    expect(formatSignalReportSummaryMarkdown(input)).toBe(expected);
  });
});
