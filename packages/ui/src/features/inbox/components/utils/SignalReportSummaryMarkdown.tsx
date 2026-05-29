import { MarkdownRenderer } from "@posthog/ui/features/editor/components/MarkdownRenderer";
import { formatSignalReportSummaryMarkdown } from "@posthog/ui/features/inbox/utils/formatSignalReportSummaryMarkdown";
import { Box } from "@radix-ui/themes";

interface SignalReportSummaryMarkdownProps {
  content: string | null;
  /** Shown when `content` is null or empty after trim */
  fallback: string;
  /** List rows: clamp lines and tighter spacing. Detail: full block markdown. */
  variant: "list" | "detail";
  /** Render in italic to indicate the summary is still being written. */
  pending?: boolean;
}

/**
 * Renders signal report summary as GFM markdown (matches backend / agent output).
 *
 * MarkdownRenderer inherits font-size from this wrapper, so setting `text-[Npx]`
 * on the outer Box cascades to every paragraph / em / strong / code / link.
 */
export function SignalReportSummaryMarkdown({
  content,
  fallback,
  variant,
  pending,
}: SignalReportSummaryMarkdownProps) {
  const rawContent = content?.trim() ? content : fallback;
  const raw = formatSignalReportSummaryMarkdown(rawContent);

  /** List rows: only the first line (before first newline); CSS still caps visual lines. */
  const listMarkdown = rawContent.split(/\r?\n/)[0] ?? "";

  const italicStyle = pending ? { fontStyle: "italic" as const } : undefined;

  if (variant === "list") {
    return (
      <Box
        className="line-clamp-3 min-w-0 overflow-hidden text-pretty text-left text-(--gray-11) text-[12px] [&_.rt-Text]:mb-0! [&_a]:pointer-events-auto [&_li]:mb-0 [&_p]:mb-0! [&_ul]:mb-0!"
        style={italicStyle}
      >
        <MarkdownRenderer content={listMarkdown} />
      </Box>
    );
  }

  return (
    <Box
      className="min-w-0 text-pretty break-words text-(--gray-11) text-[13px] [&_*]:leading-relaxed [&_.rt-Text]:mb-2 [&_a]:pointer-events-auto [&_li]:mb-1 [&_p:last-child]:mb-0"
      style={italicStyle}
    >
      <MarkdownRenderer content={raw} />
    </Box>
  );
}
