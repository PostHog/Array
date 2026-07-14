// biome-ignore-all lint/suspicious/noArrayIndexKey: query result rows and cells are purely positional
import { LineChart, type Series, useChartTheme } from "@posthog/quill-charts";
import { Text } from "@radix-ui/themes";
import type { JSX } from "react";
import { useMemo } from "react";
import type { NotebookComponentRenderProps } from "../markdown-notebook/types";
import { getStringProp } from "./embedProps";
import {
  coerceQueryOutcome,
  deriveQueryTitle,
  type FunnelStepSummary,
  type QueryOutcome,
  type RetentionRowSummary,
  type TrendsSeries,
  unwrapQueryNode,
} from "./queryPresentation";
import { useEmbedQuery } from "./useEmbedQuery";

// Live view for `<Query …/>` blocks: runs the query node against the real
// PostHog API — the desktop replacement for the webapp's notebook-node
// runtime.
export function QueryEmbed({
  node,
}: NotebookComponentRenderProps): JSX.Element {
  const rawQuery = node.props.query;
  const query =
    rawQuery && typeof rawQuery === "object" && !Array.isArray(rawQuery)
      ? (rawQuery as Record<string, unknown>)
      : null;
  const queryKey = useMemo(() => JSON.stringify(query), [query]);

  const { data, isLoading, error } = useEmbedQuery(
    ["query", queryKey],
    async (client): Promise<QueryRunResult> => {
      if (!query) throw new Error("No query to run");
      if (query.kind === "SavedInsightNode") {
        const shortId = String(query.shortId ?? "");
        const insight = await client.getInsightByShortId(shortId);
        return {
          fetchedTitle: insight.name ?? undefined,
          outcome: coerceQueryOutcome({ results: insight.result }),
        };
      }
      const response = await client.runQueryNode(unwrapQueryNode(query));
      return { outcome: coerceQueryOutcome(response) };
    },
    { enabled: query !== null },
  );

  const title =
    getStringProp(node.props.title) ??
    data?.fetchedTitle ??
    deriveQueryTitle(query) ??
    undefined;

  if (!query) {
    return (
      <QueryFrame>
        <Text size="1" color="gray">
          This block has no query configured.
        </Text>
      </QueryFrame>
    );
  }
  if (isLoading) {
    return (
      <QueryFrame>
        <div className="h-3 w-1/3 animate-pulse rounded bg-(--gray-4)" />
        <div className="mt-2 h-24 animate-pulse rounded bg-(--gray-3)" />
      </QueryFrame>
    );
  }
  if (error || !data) {
    return (
      <QueryFrame>
        <Text size="1" color="red">
          Query failed:{" "}
          {error instanceof Error ? error.message : "unknown error"}
        </Text>
      </QueryFrame>
    );
  }

  return (
    <QueryFrame title={title}>
      <QueryResult outcome={data.outcome} />
    </QueryFrame>
  );
}

interface QueryRunResult {
  fetchedTitle?: string;
  outcome: QueryOutcome;
}

function QueryFrame({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md p-3">
      {title ? (
        <Text as="div" size="2" weight="medium" className="mb-2">
          {title}
        </Text>
      ) : null}
      {children}
    </div>
  );
}

const MAX_TABLE_ROWS = 50;

function QueryResult({ outcome }: { outcome: QueryOutcome }) {
  if (outcome.kind === "trends") {
    return <TrendsChart series={outcome.series} />;
  }
  if (outcome.kind === "funnel") {
    return <FunnelSteps steps={outcome.steps} />;
  }
  if (outcome.kind === "retention") {
    return <RetentionTable rows={outcome.rows} />;
  }
  if (outcome.kind === "table") {
    return (
      <div className="max-h-80 overflow-auto rounded border border-(--gray-4)">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-(--gray-2)">
            <tr>
              {outcome.columns.map((column) => (
                <th
                  key={column}
                  className="border-(--gray-4) border-b px-2 py-1.5 text-left font-medium text-(--gray-11)"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {outcome.rows.slice(0, MAX_TABLE_ROWS).map((row, rowIndex) => (
              <tr key={rowIndex} className="odd:bg-(--gray-1)">
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className="max-w-64 truncate border-(--gray-3) border-b px-2 py-1 text-(--gray-12)"
                  >
                    {formatCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {outcome.rows.length > MAX_TABLE_ROWS ? (
          <div className="px-2 py-1 text-(--gray-9) text-xs">
            Showing {MAX_TABLE_ROWS} of {outcome.rows.length} rows
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <pre className="max-h-64 overflow-auto rounded bg-(--gray-2) p-2 text-xs">
      {JSON.stringify(outcome.value, null, 2)}
    </pre>
  );
}

function TrendsChart({ series }: { series: TrendsSeries[] }) {
  const theme = useChartTheme();
  const chartSeries: Series[] = useMemo(
    () =>
      series.slice(0, 6).map((entry, index) => ({
        key: entry.label ?? `series-${index}`,
        label: entry.label ?? `Series ${index + 1}`,
        data: entry.data ?? [],
        color: theme.colors[index % theme.colors.length],
      })),
    [series, theme.colors],
  );
  const labels = useMemo(() => {
    const first = series[0];
    return (first?.labels ?? first?.days ?? []).map(String);
  }, [series]);

  if (chartSeries.length === 0) {
    return (
      <Text size="1" color="gray">
        No results.
      </Text>
    );
  }

  return (
    <div className="flex h-[240px] w-full flex-col">
      <LineChart
        series={chartSeries}
        labels={labels}
        config={{ showAxisLines: true, showCrosshair: true }}
        theme={theme}
        dataAttr="notebook-query-chart"
      />
    </div>
  );
}

function FunnelSteps({ steps }: { steps: FunnelStepSummary[] }) {
  const maxCount = steps[0]?.count || 1;
  if (steps.length === 0) {
    return (
      <Text size="1" color="gray">
        No results.
      </Text>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {steps.map((step, index) => (
        <div key={index} className="flex items-center gap-2 text-xs">
          <span
            className="w-40 shrink-0 truncate text-(--gray-11)"
            title={step.name}
          >
            {index + 1}. {step.name}
          </span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-(--gray-3)">
            <div
              className="h-full rounded bg-(--accent-9)"
              style={{
                width: `${Math.min(100, (step.count / maxCount) * 100)}%`,
              }}
            />
          </div>
          <span className="w-28 shrink-0 text-right text-(--gray-11) tabular-nums">
            {step.count.toLocaleString()}
            {step.conversionRate != null
              ? ` · ${(step.conversionRate * 100).toFixed(1)}%`
              : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

const MAX_RETENTION_PERIODS = 12;

function RetentionTable({ rows }: { rows: RetentionRowSummary[] }) {
  if (rows.length === 0) {
    return (
      <Text size="1" color="gray">
        No results.
      </Text>
    );
  }
  const periodCount = Math.min(
    MAX_RETENTION_PERIODS,
    Math.max(...rows.map((row) => row.percentages.length)),
  );
  return (
    <div className="max-h-80 overflow-auto rounded border border-(--gray-4)">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-(--gray-2)">
          <tr>
            <th className="border-(--gray-4) border-b px-2 py-1.5 text-left font-medium text-(--gray-11)">
              Cohort
            </th>
            <th className="border-(--gray-4) border-b px-2 py-1.5 text-right font-medium text-(--gray-11)">
              Size
            </th>
            {Array.from({ length: periodCount }, (_, index) => (
              <th
                key={index}
                className="border-(--gray-4) border-b px-2 py-1.5 text-right font-medium text-(--gray-11)"
              >
                {index}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-(--gray-1)">
              <td className="border-(--gray-3) border-b px-2 py-1 text-(--gray-12)">
                {row.label}
              </td>
              <td className="border-(--gray-3) border-b px-2 py-1 text-right text-(--gray-12) tabular-nums">
                {row.initialCount.toLocaleString()}
              </td>
              {Array.from({ length: periodCount }, (_, index) => {
                const percentage = row.percentages[index];
                return (
                  <td
                    key={index}
                    className="border-(--gray-3) border-b px-2 py-1 text-right text-(--gray-12) tabular-nums"
                  >
                    {percentage != null ? `${percentage.toFixed(0)}%` : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(cell: unknown): string {
  if (cell == null) return "";
  if (typeof cell === "object") return JSON.stringify(cell);
  return String(cell);
}
