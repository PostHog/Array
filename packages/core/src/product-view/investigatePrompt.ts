/**
 * The Investigate task prompt: everything the Product View knows about a
 * selected element, packed for an agent with the PostHog MCP tools. This is a
 * product surface — treat it as tested code.
 *
 * Prompting principles (reliability over flair):
 * - seed concrete, re-derivable identifiers, never summaries alone
 * - verify-then-conclude: the agent must re-derive the numbers with MCP tools
 *   before drawing conclusions
 * - an ordered, bounded procedure with an explicit report shape
 * - state known caveats (checkout/deploy drift) in the prompt itself
 */

export interface InvestigateContext {
  pageUrl: string;
  environmentLabel: string;
  dataProjectId: number;
  element: {
    tag: string;
    dataAttr: string | null;
    id: string | null;
    href: string | null;
    text: string | null;
  };
  totals: { clicks: number; rageclicks: number; deadclicks: number } | null;
  errors: Array<{
    issueId: string;
    types: string[];
    occurrences: number;
    affectedUsers: number;
  }>;
  sessionIds: string[];
  traceIds: string[];
  liveLatency: { count: number; p50: number; p95: number; p99: number } | null;
  sourceFiles: string[];
  mergedPrs: Array<{ number: number; title: string; url: string }>;
  openPrs: Array<{ number: number; title: string; url: string }>;
}

function describeElement(element: InvestigateContext["element"]): string {
  const parts = [`<${element.tag}>`];
  if (element.dataAttr) parts.push(`data-attr="${element.dataAttr}"`);
  if (element.id) parts.push(`id="${element.id}"`);
  if (element.href) parts.push(`href="${element.href}"`);
  if (element.text) parts.push(`text "${element.text}"`);
  return parts.join(" ");
}

export function buildInvestigatePrompt(ctx: InvestigateContext): string {
  const sections: string[] = [];

  sections.push(
    `Investigate the health of a UI element in our product and report what (if anything) needs fixing.

Element: ${describeElement(ctx.element)}
Page: ${ctx.pageUrl}
Environment: ${ctx.environmentLabel}
PostHog data lives in project ${ctx.dataProjectId}. Time range of the seeded data: last 7 days (usage trend: 30 days).`,
  );

  const seeded: string[] = [];
  if (ctx.totals) {
    seeded.push(
      `- Interactions (7d): ${ctx.totals.clicks} clicks, ${ctx.totals.rageclicks} rage clicks, ${ctx.totals.deadclicks} dead clicks`,
    );
  }
  if (ctx.liveLatency) {
    seeded.push(
      `- Live-sampled request latency: p50 ${Math.round(ctx.liveLatency.p50)}ms, p95 ${Math.round(ctx.liveLatency.p95)}ms, p99 ${Math.round(ctx.liveLatency.p99)}ms over ${ctx.liveLatency.count} requests`,
    );
  }
  if (ctx.errors.length > 0) {
    seeded.push(
      "- Correlated error issues (exceptions in sessions that used this element):",
      ...ctx.errors.map(
        (issue) =>
          `  - issue ${issue.issueId} (${issue.types.join(", ") || "Error"}): ${issue.occurrences} occurrences, ${issue.affectedUsers} affected users`,
      ),
    );
  }
  if (ctx.sessionIds.length > 0) {
    seeded.push(`- Example session IDs: ${ctx.sessionIds.join(", ")}`);
  }
  if (ctx.traceIds.length > 0) {
    seeded.push(
      `- Trace IDs captured from requests this element triggered: ${ctx.traceIds.join(", ")}`,
    );
  }
  if (seeded.length > 0) {
    sections.push(`Seeded observations:\n${seeded.join("\n")}`);
  }

  const code: string[] = [];
  if (ctx.sourceFiles.length > 0) {
    code.push(
      `- Source files referencing this element's stable keys: ${ctx.sourceFiles.join(", ")}`,
    );
  }
  if (ctx.mergedPrs.length > 0) {
    code.push(
      "- Recently merged PRs touching those files:",
      ...ctx.mergedPrs.map((pr) => `  - #${pr.number} ${pr.title} — ${pr.url}`),
    );
  }
  if (ctx.openPrs.length > 0) {
    code.push(
      "- Open PRs touching those files:",
      ...ctx.openPrs.map((pr) => `  - #${pr.number} ${pr.title} — ${pr.url}`),
    );
  }
  if (code.length > 0) {
    sections.push(
      `Code context (from the local checkout):\n${code.join("\n")}`,
    );
  }

  sections.push(
    `Procedure — follow in order, verify before concluding. Do not trust the seeded numbers: re-derive them with the posthog MCP tools (execute-sql against project ${ctx.dataProjectId}; the error-tracking tools for the issue IDs; the apm tools — query-apm-spans / apm-trace-get — for the trace IDs; session-recording tools for the sessions) before drawing any conclusion.

1. Read the listed source files first and confirm how this element and its handlers are wired.
2. Re-derive the element's usage and frustration numbers with execute-sql (event = '$autocapture', match the element via elements_chain).
3. Pull each correlated error issue and judge whether it is actually caused by this element or merely co-occurs in the same sessions.
4. Follow the trace IDs across services with the apm tools; identify which backend endpoints/services this element exercises and their error/latency profile.
5. Check the listed PRs (and any others touching the code paths you traced) for changes that could explain what you found.
6. Watch one example session recording if the errors need user-behaviour context.

Caveats: the local checkout may drift from the deployed version — treat source locations as approximate and say so where it matters. The trace IDs came from live browsing just now; historical traces may differ.

Report back with: the root cause (or a clean bill of health), affected-user impact, the candidate fix (file + approach), and which PRs are implicated. Keep it evidence-first — every claim tied to a query, trace, or file you actually inspected.`,
  );

  return sections.join("\n\n");
}
