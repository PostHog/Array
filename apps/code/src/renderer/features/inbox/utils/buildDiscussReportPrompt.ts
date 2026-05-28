import { buildDiscussReportPrompt as buildSharedDiscussReportPrompt } from "@posthog/shared";
import { getDeeplinkProtocol } from "@shared/deeplink";

interface BuildDiscussReportPromptOptions {
  reportId: string;
  question?: string;
  isDevBuild: boolean;
}

export function buildDiscussReportPrompt({
  reportId,
  question,
  isDevBuild,
}: BuildDiscussReportPromptOptions): string {
  const reportLink = `${getDeeplinkProtocol(isDevBuild)}://inbox/${reportId}`;
  return buildSharedDiscussReportPrompt({ reportId, reportLink, question });
}
