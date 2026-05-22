const SIGNAL_SUMMARY_SECTION_HEADERS = [
  "What's happening",
  "Root cause",
  "How to resolve",
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Inserts line breaks around signal report summary section headers so each
 * label and its body render on separate lines (matches agent output like
 * `**What's happening:** text`).
 */
export function formatSignalReportSummaryMarkdown(content: string): string {
  let result = content;

  for (const header of SIGNAL_SUMMARY_SECTION_HEADERS) {
    const escaped = escapeRegExp(header);
    const boldHeaderPattern = `\\*\\*${escaped}:\\*\\*`;

    result = result.replace(
      new RegExp(`([^\\n])\\s*(${boldHeaderPattern})`, "gi"),
      "$1\n\n$2",
    );

    result = result.replace(
      new RegExp(`(${boldHeaderPattern})\\s+`, "gi"),
      "$1\n\n",
    );
  }

  return result;
}
