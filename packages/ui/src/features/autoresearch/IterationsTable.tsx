import type {
  AutoresearchDirection,
  AutoresearchIteration,
} from "@posthog/core/autoresearch/schemas";
import { computeBest, isImprovement } from "@posthog/core/autoresearch/stats";
import { Badge, Table, Text } from "@radix-ui/themes";
import { useMemo } from "react";
import { withMetricUnit } from "./metricFormat";

interface IterationsTableProps {
  iterations: AutoresearchIteration[];
  direction: AutoresearchDirection;
  unit: string | null;
}

const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
});

const timeFormat = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

function deltaColor(
  delta: number | null,
  direction: AutoresearchDirection,
): "green" | "red" | "gray" {
  if (delta === null || delta === 0) return "gray";
  return isImprovement(delta, 0, direction) ? "green" : "red";
}

export function IterationsTable({
  iterations,
  direction,
  unit,
}: IterationsTableProps) {
  const best = useMemo(
    () => computeBest(iterations, direction),
    [iterations, direction],
  );
  const newestFirst = useMemo(() => [...iterations].reverse(), [iterations]);

  if (iterations.length === 0) {
    return (
      <Text size="1" color="gray">
        No iterations recorded yet.
      </Text>
    );
  }

  return (
    <Table.Root size="1">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>#</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Value</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Δ</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Change</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Time</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {newestFirst.map((iteration) => (
          <Table.Row key={iteration.index}>
            <Table.Cell>{iteration.index}</Table.Cell>
            <Table.Cell>
              <span className="flex items-center gap-1 tabular-nums">
                {withMetricUnit(numberFormat.format(iteration.value), unit)}
                {best?.index === iteration.index && (
                  <Badge color="amber" size="1">
                    best
                  </Badge>
                )}
              </span>
            </Table.Cell>
            <Table.Cell>
              <Text
                size="1"
                color={deltaColor(iteration.delta, direction)}
                className="tabular-nums"
              >
                {iteration.delta === null
                  ? "—"
                  : withMetricUnit(
                      `${iteration.delta > 0 ? "+" : ""}${numberFormat.format(iteration.delta)}`,
                      unit,
                    )}
              </Text>
            </Table.Cell>
            <Table.Cell className="max-w-[320px]">
              <Text
                size="1"
                className="block truncate"
                title={iteration.summary ?? undefined}
              >
                {iteration.summary ?? "—"}
              </Text>
            </Table.Cell>
            <Table.Cell>
              <Text size="1" color="gray">
                {timeFormat.format(iteration.at)}
              </Text>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
