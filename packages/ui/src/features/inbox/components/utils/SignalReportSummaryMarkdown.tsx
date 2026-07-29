import { layoutReportSummary } from "@posthog/core/inbox/reportChartPlacement";
import { formatSignalReportSummaryMarkdown } from "@posthog/core/inbox/reportPresentation";
import type { ReportChart } from "@posthog/shared/types";
import { MarkdownRenderer } from "@posthog/ui/features/editor/components/MarkdownRenderer";
import { ReportChart as ReportChartCard } from "@posthog/ui/features/inbox/components/detail/ReportChart";
import { Box } from "@radix-ui/themes";

interface SignalReportSummaryMarkdownProps {
  content: string | null;
  /** Shown when `content` is null or empty after trim */
  fallback: string;
  /** List rows: clamp lines and tighter spacing. Detail: full block markdown. */
  variant: "list" | "detail";
  /** Render in italic to indicate the summary is still being written. */
  pending?: boolean;
  /**
   * Charts attached to the report. Detail only: the summary places a chart where
   * it references one with `[label](chart:<id>)`, and any the summary never
   * references render after the prose. Omit to render markdown alone.
   */
  charts?: ReportChart[];
  /** Required alongside `charts` — chart queries and links are report-scoped. */
  reportId?: string;
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
  charts,
  reportId,
}: SignalReportSummaryMarkdownProps) {
  const rawContent = content?.trim() ? content : fallback;
  const raw = formatSignalReportSummaryMarkdown(rawContent);

  /** List rows: only the first line (before first newline); CSS still caps visual lines. */
  const listMarkdown = rawContent.split(/\r?\n/)[0] ?? "";

  const pendingClass = pending ? "italic" : "";

  // A single pass over the summary's lines, and detail views aren't hot — not
  // worth memoising against the report's chart array identity.
  const layout =
    variant === "detail" && charts?.length
      ? layoutReportSummary(
          raw,
          charts.map((chart) => chart.chart_id),
        )
      : null;

  if (variant === "list") {
    return (
      <Box
        className={`line-clamp-3 min-w-0 overflow-hidden text-pretty text-left text-[12px] text-gray-11 [&_.rt-Text]:mb-0! [&_a]:pointer-events-auto [&_li]:mb-0 [&_p]:mb-0! [&_ul]:mb-0! ${pendingClass}`}
      >
        <MarkdownRenderer content={listMarkdown} />
      </Box>
    );
  }

  // Cap the body at ~80 chars (`ch` is sized to the column's "0" width, so this
  // tracks the 13px font without us hard-coding pixels). The wrapping `max-w` is
  // intrinsic – wider columns still get the prose, but narrower columns shrink
  // the cap with the container.
  return (
    <Box
      className={`min-w-0 max-w-[80ch] text-pretty break-words text-[13px] text-gray-11 [&_*]:leading-relaxed [&_.rt-Text]:mb-2 [&_a]:pointer-events-auto [&_li]:mb-1 [&_p:last-child]:mb-0 ${pendingClass}`}
    >
      {layout && charts && reportId ? (
        <SummaryWithCharts
          reportId={reportId}
          charts={charts}
          layout={layout}
        />
      ) : (
        <MarkdownRenderer content={raw} />
      )}
    </Box>
  );
}

/**
 * Prose and charts interleaved in reading order, with any chart the summary
 * never referenced appended below — an unreferenced chart is still evidence.
 */
function SummaryWithCharts({
  reportId,
  charts,
  layout,
}: {
  reportId: string;
  charts: ReportChart[];
  layout: ReturnType<typeof layoutReportSummary>;
}) {
  const placed = new Set(layout.placedChartIds);
  const chartsById = new Map(charts.map((chart) => [chart.chart_id, chart]));
  const trailing = charts.filter((chart) => !placed.has(chart.chart_id));

  return (
    <div className="flex flex-col gap-3">
      {layout.segments.map((segment, index) => {
        if (segment.kind === "markdown") {
          return (
            // Segments are positional slices of one summary; order is their identity.
            // biome-ignore lint/suspicious/noArrayIndexKey: segment order is the only identity
            <div key={index}>
              <MarkdownRenderer content={segment.content} />
            </div>
          );
        }
        const chart = chartsById.get(segment.chartId);
        if (!chart) return null;
        return (
          <ReportChartCard
            key={segment.chartId}
            reportId={reportId}
            chart={chart}
          />
        );
      })}
      {trailing.map((chart) => (
        <ReportChartCard
          key={chart.chart_id}
          reportId={reportId}
          chart={chart}
        />
      ))}
    </div>
  );
}
