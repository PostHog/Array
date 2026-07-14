import type {
  AutoresearchDirection,
  AutoresearchIteration,
} from "@posthog/core/autoresearch/schemas";
import { computeBest } from "@posthog/core/autoresearch/stats";
import { Badge, Table, Text } from "@radix-ui/themes";
import { useMemo } from "react";
import {
  type DeltaTone,
  deltaTone,
  formatMetricDelta,
  metricNumberFormat,
  withMetricUnit,
} from "./metricFormat";

interface IterationsTableProps {
  iterations: AutoresearchIteration[];
  direction: AutoresearchDirection;
  unit: string | null;
}

const timeFormat = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

const TONE_COLOR: Record<DeltaTone, "green" | "red" | "gray"> = {
  improved: "green",
  worsened: "red",
  neutral: "gray",
};

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
                {withMetricUnit(
                  metricNumberFormat.format(iteration.value),
                  unit,
                )}
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
                color={TONE_COLOR[deltaTone(iteration.delta, direction)]}
                className="tabular-nums"
              >
                {formatMetricDelta(iteration.delta, unit)}
              </Text>
            </Table.Cell>
            <Table.Cell className="max-w-[320px]">
              <div className="flex min-w-0 items-center gap-2">
                {iteration.approach && (
                  <Badge color="gray" size="1" variant="soft">
                    {iteration.approach}
                  </Badge>
                )}
                <Text
                  size="1"
                  className="block truncate"
                  title={iteration.summary ?? undefined}
                >
                  {iteration.summary ?? "None"}
                </Text>
              </div>
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
