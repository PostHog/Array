import type {
  AutoresearchDirection,
  AutoresearchIteration,
} from "@posthog/core/autoresearch/schemas";
import { Text } from "@radix-ui/themes";
import { useMemo } from "react";
import { withMetricUnit } from "./metricFormat";

const WIDTH = 640;
const HEIGHT = 220;
const PADDING = { top: 12, right: 16, bottom: 24, left: 52 };

interface MetricChartProps {
  iterations: AutoresearchIteration[];
  direction: AutoresearchDirection;
  targetValue: number | null;
  metricName: string;
  unit: string | null;
}

const wholeNumberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const fractionalNumberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

function formatValue(value: number): string {
  return (
    Math.abs(value) >= 1000 ? wholeNumberFormat : fractionalNumberFormat
  ).format(value);
}

/**
 * Metric value per iteration (solid, with dots) plus the best-so-far
 * frontier (dashed) and the optional target line.
 */
export function MetricChart({
  iterations,
  direction,
  targetValue,
  metricName,
  unit,
}: MetricChartProps) {
  const chart = useMemo(() => {
    if (iterations.length === 0) return null;

    const values = iterations.map((iteration) => iteration.value);
    const bests = iterations.map((iteration) => iteration.bestValue);
    const all = [...values, ...bests];
    if (targetValue !== null) all.push(targetValue);

    let min = Math.min(...all);
    let max = Math.max(...all);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const span = max - min;
    min -= span * 0.05;
    max += span * 0.05;

    const innerWidth = WIDTH - PADDING.left - PADDING.right;
    const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;
    const x = (index: number) =>
      PADDING.left +
      (iterations.length === 1
        ? innerWidth / 2
        : (index / (iterations.length - 1)) * innerWidth);
    const y = (value: number) =>
      PADDING.top + ((max - value) / (max - min)) * innerHeight;

    const valuePoints = iterations.map(
      (iteration, i) => `${x(i)},${y(iteration.value)}`,
    );
    const bestPoints = iterations.map(
      (iteration, i) => `${x(i)},${y(iteration.bestValue)}`,
    );

    return {
      x,
      y,
      min,
      max,
      valuePath: valuePoints.join(" "),
      bestPath: bestPoints.join(" "),
      targetY: targetValue === null ? null : y(targetValue),
    };
  }, [iterations, targetValue]);

  if (!chart) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-md border border-(--gray-5) bg-(--gray-2)">
        <Text size="1" color="gray">
          The chart fills in as iterations report "{metricName}".
        </Text>
      </div>
    );
  }

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full rounded-md border border-(--gray-5) bg-(--gray-2)"
        role="img"
        aria-label={`${metricName} per iteration (${direction})`}
      >
        {/* y-axis extremes */}
        <text
          x={PADDING.left - 6}
          y={chart.y(chart.max) + 10}
          textAnchor="end"
          className="fill-(--gray-10) text-[10px]"
        >
          {withMetricUnit(formatValue(chart.max), unit)}
        </text>
        <text
          x={PADDING.left - 6}
          y={chart.y(chart.min)}
          textAnchor="end"
          className="fill-(--gray-10) text-[10px]"
        >
          {withMetricUnit(formatValue(chart.min), unit)}
        </text>
        <line
          x1={PADDING.left}
          y1={PADDING.top}
          x2={PADDING.left}
          y2={HEIGHT - PADDING.bottom}
          className="stroke-(--gray-6)"
        />
        <line
          x1={PADDING.left}
          y1={HEIGHT - PADDING.bottom}
          x2={WIDTH - PADDING.right}
          y2={HEIGHT - PADDING.bottom}
          className="stroke-(--gray-6)"
        />

        {chart.targetY !== null && (
          <g>
            <line
              x1={PADDING.left}
              y1={chart.targetY}
              x2={WIDTH - PADDING.right}
              y2={chart.targetY}
              strokeDasharray="2 4"
              className="stroke-(--green-9)"
            />
            <text
              x={WIDTH - PADDING.right}
              y={chart.targetY - 4}
              textAnchor="end"
              className="fill-(--green-11) text-[10px]"
            >
              target {withMetricUnit(formatValue(targetValue ?? 0), unit)}
            </text>
          </g>
        )}

        <polyline
          points={chart.bestPath}
          fill="none"
          strokeDasharray="4 4"
          strokeWidth={1.5}
          className="stroke-(--gray-9)"
        />
        <polyline
          points={chart.valuePath}
          fill="none"
          strokeWidth={2}
          className="stroke-(--accent-9)"
        />
        {iterations.map((iteration, i) => (
          <circle
            key={iteration.index}
            cx={chart.x(i)}
            cy={chart.y(iteration.value)}
            r={3}
            className="fill-(--accent-9)"
          >
            <title>
              {`Iteration ${iteration.index}: ${withMetricUnit(formatValue(iteration.value), unit)}${iteration.summary ? ` — ${iteration.summary}` : ""}`}
            </title>
          </circle>
        ))}

        {/* x-axis extremes */}
        <text
          x={chart.x(0)}
          y={HEIGHT - PADDING.bottom + 14}
          textAnchor="middle"
          className="fill-(--gray-10) text-[10px]"
        >
          1
        </text>
        {iterations.length > 1 && (
          <text
            x={chart.x(iterations.length - 1)}
            y={HEIGHT - PADDING.bottom + 14}
            textAnchor="middle"
            className="fill-(--gray-10) text-[10px]"
          >
            {iterations[iterations.length - 1].index}
          </text>
        )}
      </svg>
      <figcaption className="mt-1 flex items-center gap-3 text-(--gray-10) text-[11px]">
        <span className="flex items-center gap-1">
          <span className="inline-block h-[2px] w-4 bg-(--accent-9)" /> value
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-[2px] w-4 border-(--gray-9) border-t border-dashed" />{" "}
          best so far
        </span>
      </figcaption>
    </figure>
  );
}
