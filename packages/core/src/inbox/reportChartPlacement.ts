import { matchReportChartRef } from "@posthog/shared";

/**
 * Splits a report summary into the pieces a detail view renders in order:
 * prose, and the charts the prose places.
 *
 * A summary places a chart with a `[label](chart:<chart_id>)` link (see
 * `packages/shared/src/report-charts.ts`). Rather than teaching the markdown
 * renderer to swap an inline anchor for a block-level chart — which would nest a
 * chart inside a `<p>` — we cut the summary at the paragraphs that exist purely
 * to hold chart references and hand the remaining prose to the renderer
 * unchanged. Splitting only at those paragraphs keeps every other markdown
 * construct (lists, tables, fenced code) inside a single render pass.
 *
 * Placement rules, matching web:
 * - Only a paragraph consisting solely of chart references places charts. A
 *   reference inside a sentence, a list item, a table cell, or a code fence
 *   stays as its label text.
 * - The first reference to an id places it; later ones fall back to their label.
 * - Ids with no matching chart fall back to their label too, so a stale
 *   reference reads as text rather than vanishing.
 * - A summary carrying link-reference or footnote definitions isn't split at all
 *   (see `REFERENCE_DEFINITION`); its charts all render after the prose.
 */

export type ReportSummarySegment =
  | { kind: "markdown"; content: string }
  | { kind: "chart"; chartId: string };

export interface ReportSummaryLayout {
  segments: ReportSummarySegment[];
  /** Ids placed inline, in placement order. The rest render after the summary. */
  placedChartIds: string[];
}

/**
 * A markdown inline link whose target is a chart reference, with an optional
 * link title. Labels containing `]` aren't supported — neither is the reference
 * generator that writes them.
 */
const CHART_LINK = /\[([^\]]*)\]\(\s*(chart:[^\s)"]+)\s*(?:"[^"]*"\s*)?\)/g;

/** Markdown treats four leading spaces as an indented code block. */
const MAX_LEADING_SPACES = 3;

/** Tolerated between references on a placement line, alongside whitespace. */
const LINE_BREAK_TAGS = /<br\s*\/?>/gi;

/** Opens or closes a fenced code block. */
const FENCE = /^ {0,3}(?:`{3,}|~{3,})/;

/**
 * A link-reference or footnote definition (`[1]: …`, `[^note]: …`). These resolve
 * document-wide, so a definition and its use can sit either side of a chart —
 * and splitting the summary would strand them in separate render passes, leaving
 * the reference as literal `\[label]\[1]` text. Rare enough in report summaries
 * that skipping inline placement entirely is the right trade: charts still render
 * after the prose, and the prose stays intact.
 */
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+]:/m;

interface ChartReference {
  /** The full `[label](chart:id)` source, used when the reference can't place. */
  source: string;
  chartId: string | null;
}

/**
 * The chart references on a line, but only when the line holds nothing else —
 * that is the signal the paragraph exists to place charts. Null for any other
 * line, including blank ones.
 */
function matchPlacementLine(line: string): ChartReference[] | null {
  const leadingSpaces = line.length - line.trimStart().length;
  if (leadingSpaces > MAX_LEADING_SPACES) return null;

  const trimmed = line.trim();
  if (!trimmed) return null;

  const references: ChartReference[] = [];
  const remainder = trimmed
    .replace(CHART_LINK, (source, _label: string, target: string) => {
      references.push({ source, chartId: matchReportChartRef(target) });
      return "";
    })
    .replace(LINE_BREAK_TAGS, "");

  if (references.length === 0 || remainder.trim().length > 0) return null;
  return references;
}

/**
 * Per-line chart references, set only for lines belonging to a paragraph whose
 * every line is a placement line. Paragraph = a maximal run of non-blank lines
 * outside any code fence.
 */
function findPlacementParagraphs(lines: string[]): (ChartReference[] | null)[] {
  const candidates = lines.map((line) => matchPlacementLine(line));
  const resolved: (ChartReference[] | null)[] = lines.map(() => null);

  let inFence = false;
  let paragraphStart: number | null = null;
  let paragraphPlaces = true;

  const closeParagraph = (end: number) => {
    if (paragraphStart !== null && paragraphPlaces) {
      for (let i = paragraphStart; i < end; i++) resolved[i] = candidates[i];
    }
    paragraphStart = null;
    paragraphPlaces = true;
  };

  for (const [index, line] of lines.entries()) {
    if (FENCE.test(line)) {
      closeParagraph(index);
      inFence = !inFence;
      continue;
    }
    if (inFence || line.trim() === "") {
      closeParagraph(index);
      continue;
    }
    if (paragraphStart === null) paragraphStart = index;
    if (!candidates[index]) paragraphPlaces = false;
  }
  closeParagraph(lines.length);

  return resolved;
}

export function layoutReportSummary(
  summary: string,
  chartIds: readonly string[],
): ReportSummaryLayout {
  if (REFERENCE_DEFINITION.test(summary)) {
    return {
      segments: [{ kind: "markdown", content: summary }],
      placedChartIds: [],
    };
  }

  const available = new Set(chartIds);
  const segments: ReportSummarySegment[] = [];
  const placedChartIds: string[] = [];
  const placed = new Set<string>();

  const lines = summary.split("\n");
  const placements = findPlacementParagraphs(lines);

  /** Prose accumulated since the last chart, flushed as one markdown segment. */
  let buffer: string[] = [];
  const flushBuffer = () => {
    const content = buffer.join("\n");
    buffer = [];
    if (content.trim()) segments.push({ kind: "markdown", content });
  };

  for (const [index, line] of lines.entries()) {
    const references = placements[index];
    if (!references) {
      buffer.push(line);
      continue;
    }

    /** References this line couldn't place, kept as text in reading order. */
    const unplaceable: string[] = [];
    for (const { source, chartId } of references) {
      if (!chartId || !available.has(chartId) || placed.has(chartId)) {
        unplaceable.push(source);
        continue;
      }
      // Prose first, then any labels preceding the chart on this line.
      if (unplaceable.length > 0) {
        buffer.push(unplaceable.join(" "));
        unplaceable.length = 0;
      }
      flushBuffer();
      placed.add(chartId);
      placedChartIds.push(chartId);
      segments.push({ kind: "chart", chartId });
    }
    if (unplaceable.length > 0) buffer.push(unplaceable.join(" "));
  }

  flushBuffer();
  return { segments, placedChartIds };
}
