import {
  buildInboxDeeplink,
  buildDiscussReportPrompt as buildSharedDiscussReportPrompt,
  getDeeplinkProtocol,
} from "@posthog/shared";

interface BuildCreatePrReportPromptOptions {
  reportId: string;
  isDevBuild: boolean;
}

export function buildCreatePrReportPrompt({
  reportId,
  isDevBuild,
}: BuildCreatePrReportPromptOptions): string {
  const reportLink = `${getDeeplinkProtocol(isDevBuild)}://inbox/${reportId}`;
  return `Act on PostHog inbox report ${reportId} ([inbox item](${reportLink})). Use the inbox MCP tools to fetch the report, its signals, and any suggested reviewers; investigate the root cause; implement the fix; and open a PR. If you can't fetch the report, stop and report that instead of guessing what it contains.`;
}

interface BuildDiscussReportPromptOptions {
  reportId: string;
  reportTitle?: string | null;
  question?: string;
  isDevBuild: boolean;
}

export function buildDiscussReportPrompt({
  reportId,
  reportTitle,
  question,
  isDevBuild,
}: BuildDiscussReportPromptOptions): string {
  const reportLink = buildInboxDeeplink(reportId, reportTitle, { isDevBuild });
  return buildSharedDiscussReportPrompt({ reportId, reportLink, question });
}
