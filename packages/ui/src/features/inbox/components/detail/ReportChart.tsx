import { ArrowSquareOutIcon, ChartLineIcon } from "@phosphor-icons/react";
import {
  planReportChart,
  type ReportChartPlan,
  resolveReportChartSize,
  shapeNumberResponse,
  shapeTableResponse,
  shapeTrendsResponse,
} from "@posthog/core/inbox/reportCharts";
import {
  type Series,
  TimeSeriesBarChart,
  TimeSeriesLineChart,
  useChartTheme,
} from "@posthog/quill-charts";
import type {
  ReportChart as ReportChartModel,
  ReportChartSize,
} from "@posthog/shared/types";
import { useReportChartData } from "@posthog/ui/features/inbox/hooks/useReportChartData";
import { openExternalUrl } from "@posthog/ui/shell/openExternal";
import { inboxReportUrl } from "@posthog/ui/utils/posthogLinks";
import { Flex, Text } from "@radix-ui/themes";
import { useMemo } from "react";

interface ReportChartProps {
  reportId: string;
  chart: ReportChartModel;
}

/** Body heights per size bucket, matching web's 9rem / 18rem / 28rem. */
const HEIGHT_CLASS: Record<ReportChartSize, string> = {
  small: "h-36",
  medium: "h-72",
  large: "h-[28rem]",
};

/**
 * One chart attached to a report, drawn read-only. Trends and SQL results render
 * natively; anything the desktop app has no renderer for keeps its title and
 * caption and offers the report in PostHog instead, so the evidence degrades
 * visibly rather than disappearing.
 */
export function ReportChart({ reportId, chart }: ReportChartProps) {
  const plan = useMemo(() => planReportChart(chart), [chart]);
  const size = resolveReportChartSize(chart, plan);

  return (
    <figure className="m-0 min-w-0 overflow-hidden rounded-(--radius-2) border border-(--gray-5) bg-gray-1">
      <Flex
        align="center"
        gap="2"
        className="min-w-0 border-(--gray-5) border-b px-3 py-2"
      >
        <ChartLineIcon size={13} className="shrink-0 text-gray-11" />
        <Text className="truncate font-medium text-[12px] text-gray-12">
          {chart.title}
        </Text>
      </Flex>
      <div className="p-3">
        {plan.kind === "unsupported" ? (
          <ChartUnavailable reportId={reportId} message={plan.reason} />
        ) : (
          <ChartBody
            reportId={reportId}
            chart={chart}
            plan={plan}
            heightClass={HEIGHT_CLASS[size]}
          />
        )}
      </div>
      {chart.caption && (
        <figcaption className="border-(--gray-5) border-t px-3 py-2 text-[11px] text-gray-10">
          {chart.caption}
        </figcaption>
      )}
    </figure>
  );
}

function ChartBody({
  reportId,
  chart,
  plan,
  heightClass,
}: {
  reportId: string;
  chart: ReportChartModel;
  plan: Exclude<ReportChartPlan, { kind: "unsupported" }>;
  heightClass: string;
}) {
  const theme = useChartTheme();
  const { data, isPending, isError, error } = useReportChartData(
    reportId,
    chart,
  );

  if (isPending) {
    return (
      <div
        className={`${heightClass} animate-pulse rounded-(--radius-1) bg-gray-3`}
      />
    );
  }
  if (isError) {
    return (
      <ChartUnavailable
        reportId={reportId}
        message={
          error instanceof Error && error.message
            ? `Couldn't load this chart: ${error.message}`
            : "Couldn't load this chart."
        }
      />
    );
  }

  if (plan.kind === "number") {
    const shaped = shapeNumberResponse(data);
    if (!shaped) return <ChartEmpty />;
    return (
      <Flex
        direction="column"
        gap="1"
        className={`${heightClass} justify-center`}
      >
        <Text className="font-semibold text-[28px] text-gray-12 tabular-nums">
          {shaped.value.toLocaleString()}
        </Text>
        <Text className="text-[11px] text-gray-10">{shaped.label}</Text>
      </Flex>
    );
  }

  if (plan.kind === "table") {
    const shaped = shapeTableResponse(data);
    if (!shaped || shaped.rows.length === 0) return <ChartEmpty />;
    return (
      <div className={`${heightClass} overflow-auto`}>
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-gray-1">
            <tr className="border-(--gray-5) border-b">
              {shaped.columns.map((column) => (
                <th
                  key={column}
                  className="whitespace-nowrap px-2 py-1 text-left font-medium text-gray-11"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shaped.rows.map((row, rowIndex) => (
              // Rows carry no id, and duplicate rows are legitimate query output.
              // biome-ignore lint/suspicious/noArrayIndexKey: row order is the only identity
              <tr key={rowIndex} className="border-(--gray-3) border-b">
                {row.map((cell, cellIndex) => (
                  <td
                    // biome-ignore lint/suspicious/noArrayIndexKey: column order is the only identity
                    key={cellIndex}
                    className="max-w-[24ch] truncate px-2 py-1 text-gray-12 tabular-nums"
                    title={cell}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {shaped.truncatedRows > 0 && (
          <Text as="p" className="px-2 py-1 text-[11px] text-gray-10">
            {shaped.truncatedRows} more row
            {shaped.truncatedRows === 1 ? "" : "s"} not shown.
          </Text>
        )}
      </div>
    );
  }

  const shaped = shapeTrendsResponse(data);
  if (!shaped) return <ChartEmpty />;
  const series: Series[] = shaped.series.map((entry) => ({
    key: entry.key,
    label: entry.label,
    data: entry.data,
  }));
  const config = {
    xAxis: { interval: "day" as const },
    showCrosshair: true,
    showAxisLines: true,
  };

  return (
    // flex-col + fixed height: the quill chart sizes its canvas by filling a
    // flex-column parent; a plain block collapses it to 0.
    <div className={`flex ${heightClass} w-full flex-col`}>
      {plan.variant === "bar" ? (
        <TimeSeriesBarChart
          series={series}
          labels={shaped.labels}
          config={{ ...config, barCornerRadius: 2 }}
          theme={theme}
        />
      ) : (
        <TimeSeriesLineChart
          series={series}
          labels={shaped.labels}
          config={config}
          theme={theme}
        />
      )}
    </div>
  );
}

function ChartEmpty() {
  return (
    <Text as="p" className="py-6 text-center text-[11px] text-gray-10">
      This chart's query returned no data.
    </Text>
  );
}

/**
 * The visible degradation: says why the chart isn't drawn and links to the
 * report in PostHog, which renders it.
 */
function ChartUnavailable({
  reportId,
  message,
}: {
  reportId: string;
  message: string;
}) {
  const url = inboxReportUrl(reportId);
  return (
    <Flex direction="column" align="start" gap="2" className="py-2">
      <Text className="text-[11px] text-gray-10">{message}</Text>
      {url && (
        <button
          type="button"
          onClick={() => openExternalUrl(url)}
          className="inline-flex items-center gap-1 text-[11px] text-gray-11 hover:text-gray-12"
        >
          Open the report in PostHog
          <ArrowSquareOutIcon size={11} />
        </button>
      )}
    </Flex>
  );
}
