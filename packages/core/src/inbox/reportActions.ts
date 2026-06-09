import { buildDiscussReportPrompt as buildSharedDiscussReportPrompt } from "@posthog/shared";
import {
  buildInboxDeeplink,
  getDeeplinkProtocol,
} from "@posthog/shared/deeplink";
import type { SignalReport } from "@posthog/shared/types";

/**
 * Should the Create PR action be offered on this report?
 *
 * Mirrors the server-side autostart rules: only when the report is ready and
 * actually actionable, or when it's blocked on user input the user can supply.
 * Hidden once an implementation PR exists or the issue is already fixed.
 */
export function canCreateImplementationPr(report: SignalReport): boolean {
  if (report.implementation_pr_url) return false;
  if (report.already_addressed === true) return false;
  if (report.status === "pending_input") return true;
  if (report.status === "ready") {
    return (
      report.actionability === "immediately_actionable" ||
      report.actionability === "requires_human_input"
    );
  }
  return false;
}

interface BuildCreatePrReportPromptOptions {
  reportId: string;
  isDevBuild: boolean;
  feedback?: string;
}

export function buildCreatePrReportPrompt({
  reportId,
  isDevBuild,
  feedback,
}: BuildCreatePrReportPromptOptions): string {
  const reportLink = `${getDeeplinkProtocol(isDevBuild)}://inbox/${reportId}`;
  const base = `Act on PostHog inbox report ${reportId} ([inbox item](${reportLink})). Use the inbox MCP tools to fetch the report, its contributing findings, and any suggested reviewers; investigate the root cause; implement the fix; and open a PR. If you can't fetch the report, stop and report that instead of guessing what it contains.`;
  const trimmedFeedback = feedback?.trim();
  if (!trimmedFeedback) return base;
  return `${base}\n\nAdditional feedback from the user (take this into account, including any questions raised in the report thread):\n${trimmedFeedback}`;
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
