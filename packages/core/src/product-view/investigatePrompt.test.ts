import { describe, expect, it } from "vitest";
import { buildInvestigatePrompt } from "./investigatePrompt";

const context = {
  pageUrl: "https://posthog.com/",
  environmentLabel: "Production",
  dataProjectId: 2,
  element: {
    tag: "a",
    dataAttr: null,
    id: null,
    href: "https://us.posthog.com",
    text: "Open PostHog",
  },
  totals: { clicks: 32413, rageclicks: 120, deadclicks: 3 },
  errors: [
    {
      issueId: "019f6b23-95c1",
      types: ["Error"],
      occurrences: 13066,
      affectedUsers: 970,
    },
  ],
  sessionIds: ["019fb8ce-328e"],
  traceIds: ["21edb3a025a9ecd32adf3e5d7548a4f4"],
  liveLatency: { count: 12, p50: 120, p95: 480, p99: 900 },
  sourceFiles: ["src/components/Nav.tsx"],
  mergedPrs: [
    { number: 123, title: "feat: nav", url: "https://github.com/x/y/pull/123" },
  ],
  openPrs: [
    {
      number: 456,
      title: "wip: nav v2",
      url: "https://github.com/x/y/pull/456",
    },
  ],
};

describe("buildInvestigatePrompt", () => {
  const prompt = buildInvestigatePrompt(context);

  it("seeds every concrete identifier the agent needs", () => {
    expect(prompt).toContain("https://posthog.com/");
    expect(prompt).toContain('href="https://us.posthog.com"');
    expect(prompt).toContain("Open PostHog");
    expect(prompt).toContain("019f6b23-95c1");
    expect(prompt).toContain("019fb8ce-328e");
    expect(prompt).toContain("21edb3a025a9ecd32adf3e5d7548a4f4");
    expect(prompt).toContain("src/components/Nav.tsx");
    expect(prompt).toContain("https://github.com/x/y/pull/123");
    expect(prompt).toContain("https://github.com/x/y/pull/456");
    expect(prompt).toContain("project 2");
  });

  it("instructs verify-then-conclude with the posthog MCP tools", () => {
    expect(prompt).toMatch(/do not trust the seeded numbers/i);
    expect(prompt).toContain("execute-sql");
    expect(prompt).toContain("error-tracking");
    expect(prompt).toContain("apm");
    expect(prompt).toContain("session-recording");
  });

  it("states the drift caveat and asks for a structured readout", () => {
    expect(prompt).toMatch(/checkout may drift/i);
    expect(prompt).toMatch(/root cause/i);
  });

  it("omits empty sections rather than rendering placeholders", () => {
    const bare = buildInvestigatePrompt({
      ...context,
      errors: [],
      traceIds: [],
      sourceFiles: [],
      mergedPrs: [],
      openPrs: [],
      liveLatency: null,
      totals: null,
    });
    expect(bare).not.toContain("Correlated error issues");
    expect(bare).not.toContain("Trace IDs");
    expect(bare).not.toContain("undefined");
    expect(bare).not.toContain("null");
  });
});
