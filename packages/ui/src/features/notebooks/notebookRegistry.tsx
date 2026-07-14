// biome-ignore-all lint/suspicious/noArrayIndexKey: query result rows and cells are purely positional
import { LineChart, type Series, useChartTheme } from "@posthog/quill-charts";
import { useOptionalAuthenticatedClient } from "@posthog/ui/features/auth/authClient";
import { Text } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  getMarkdownNotebookDefaultRegistry,
  mergeMarkdownNotebookRegistries,
} from "./markdown-notebook/registry";
import type {
  NotebookComponentRegistry,
  NotebookComponentRenderProps,
} from "./markdown-notebook/types";

// The default registry renders `<Query …/>` blocks as a JSON preview. This
// registry swaps in a live view that runs the query node against the real
// PostHog API — the desktop replacement for the webapp's notebook-node
// runtime.
export function getNotebooksAppRegistry(): NotebookComponentRegistry {
  const base = getMarkdownNotebookDefaultRegistry();
  const queryDefinition = base.components.Query;
  if (!queryDefinition) return base;
  return mergeMarkdownNotebookRegistries(base, {
    components: {
      Query: {
        ...queryDefinition,
        ViewComponent: NotebookQueryView,
      },
    },
  });
}

type TrendsSeries = {
  label?: string;
  data?: number[];
  labels?: string[];
  days?: string[];
};

type QueryRunOutcome =
  | { kind: "trends"; series: TrendsSeries[] }
  | { kind: "table"; columns: string[]; rows: unknown[][] }
  | { kind: "json"; value: unknown };

/**
 * Unwrap presentation wrappers (DataTableNode, InsightVizNode) to the
 * executable source node, mirroring how the webapp resolves query nodes.
 */
function unwrapQueryNode(
  query: Record<string, unknown>,
): Record<string, unknown> {
  const kind = query.kind;
  if (
    (kind === "DataTableNode" || kind === "InsightVizNode") &&
    query.source &&
    typeof query.source === "object"
  ) {
    return query.source as Record<string, unknown>;
  }
  return query;
}

function coerceOutcome(response: unknown): QueryRunOutcome {
  if (response && typeof response === "object") {
    const body = response as { columns?: unknown; results?: unknown };
    const results = body.results;
    if (Array.isArray(body.columns) && Array.isArray(results)) {
      return {
        kind: "table",
        columns: body.columns.map(String),
        rows: results.map((row) =>
          Array.isArray(row) ? row : [JSON.stringify(row)],
        ),
      };
    }
    if (
      Array.isArray(results) &&
      results.every(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          Array.isArray((entry as TrendsSeries).data),
      )
    ) {
      return { kind: "trends", series: results as TrendsSeries[] };
    }
  }
  return { kind: "json", value: response };
}

function NotebookQueryView({ node }: NotebookComponentRenderProps) {
  const client = useOptionalAuthenticatedClient();
  const rawQuery = node.props.query;
  const query =
    rawQuery && typeof rawQuery === "object" && !Array.isArray(rawQuery)
      ? (rawQuery as Record<string, unknown>)
      : null;
  const queryKey = useMemo(() => JSON.stringify(query), [query]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["notebook-query", queryKey],
    queryFn: async (): Promise<QueryRunOutcomeWithTitle> => {
      if (!client || !query) throw new Error("No query to run");
      if (query.kind === "SavedInsightNode") {
        const shortId = String(query.shortId ?? "");
        const insight = await client.getInsightByShortId(shortId);
        return {
          title: insight.name ?? undefined,
          outcome: coerceOutcome({ results: insight.result }),
        };
      }
      const response = await client.runQueryNode(unwrapQueryNode(query));
      return { outcome: coerceOutcome(response) };
    },
    enabled: client !== null && query !== null,
    staleTime: 5 * 60_000,
    retry: 1,
  });

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
    <QueryFrame title={data.title}>
      <QueryResult outcome={data.outcome} />
    </QueryFrame>
  );
}

interface QueryRunOutcomeWithTitle {
  title?: string;
  outcome: QueryRunOutcome;
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

function QueryResult({ outcome }: { outcome: QueryRunOutcome }) {
  if (outcome.kind === "trends") {
    return <TrendsChart series={outcome.series} />;
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

function formatCell(cell: unknown): string {
  if (cell == null) return "";
  if (typeof cell === "object") return JSON.stringify(cell);
  return String(cell);
}
