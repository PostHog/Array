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
  const trimmedQuestion = question?.trim();
  const reportLink = `${getDeeplinkProtocol(isDevBuild)}://inbox/${reportId}`;
  const intro = `Discuss PostHog inbox report ${reportId} ([inbox item](${reportLink})). Use the inbox MCP tools to fetch the report,`;
  return trimmedQuestion
    ? `${intro} then answer this first: ${trimmedQuestion}`
    : `${intro} then give me a brief readout and ask what I want to dig into.`;
}
