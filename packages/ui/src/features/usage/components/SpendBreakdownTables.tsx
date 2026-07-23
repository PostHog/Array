import { Ruler, Stack, Wrench } from "@phosphor-icons/react";
import {
  formatTokens,
  formatUsd,
} from "@posthog/core/billing/spendAnalysisFormat";
import type {
  SpendAnalysisInputSizeRow,
  SpendAnalysisProductRow,
  SpendAnalysisToolRow,
} from "@posthog/core/billing/spendAnalysisTypes";
import { Table, Text } from "@radix-ui/themes";
import { UsageCard } from "./UsageCard";

function BreakdownTable({
  headers,
  widths,
  children,
}: {
  headers: string[];
  widths: string[];
  children: React.ReactNode;
}) {
  return (
    <Table.Root
      size="1"
      className="[&_td]:!py-1.5 [&_th]:!py-1.5 [&_table]:w-full [&_table]:table-fixed [&_td]:overflow-hidden [&_td]:align-middle [&_th]:align-middle"
    >
      <Table.Header>
        <Table.Row>
          {headers.map((h, i) => (
            <Table.ColumnHeaderCell
              key={h}
              className="font-normal text-[12px] text-gray-11"
              style={{ width: widths[i] }}
            >
              {h}
            </Table.ColumnHeaderCell>
          ))}
        </Table.Row>
      </Table.Header>
      <Table.Body>{children}</Table.Body>
    </Table.Root>
  );
}

export function ToolBreakdownCard({ rows }: { rows: SpendAnalysisToolRow[] }) {
  if (rows.length === 0) return null;
  // The backend rolls out attributed cost per response, not per row: if the
  // top row has it, every row does.
  const hasAttributedCost = rows[0]?.cost_attributed_usd !== undefined;

  return (
    <UsageCard
      icon={<Wrench size={14} className="text-(--gray-9)" />}
      title="By tool"
    >
      <BreakdownTable
        headers={
          hasAttributedCost
            ? ["Tool", "Generations", "Avg input", "Cost", "Attributed"]
            : ["Tool", "Generations", "Avg input", "Cost"]
        }
        widths={
          hasAttributedCost
            ? ["32%", "18%", "18%", "16%", "16%"]
            : ["40%", "20%", "20%", "20%"]
        }
      >
        {rows.slice(0, 10).map((r) => (
          <Table.Row key={r.tool ?? "(null)"}>
            <Table.Cell>{r.tool ?? "Text response"}</Table.Cell>
            <Table.Cell>{r.generation_count.toLocaleString()}</Table.Cell>
            <Table.Cell>{formatTokens(r.avg_input_tokens)}</Table.Cell>
            <Table.Cell>{formatUsd(r.cost_usd)}</Table.Cell>
            {hasAttributedCost && (
              <Table.Cell>
                {r.cost_attributed_usd !== undefined
                  ? formatUsd(r.cost_attributed_usd)
                  : "—"}
              </Table.Cell>
            )}
          </Table.Row>
        ))}
      </BreakdownTable>
    </UsageCard>
  );
}

export function ProductBreakdownCard({
  rows,
}: {
  rows: SpendAnalysisProductRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <UsageCard
      icon={<Stack size={14} className="text-(--gray-9)" />}
      title="By product"
    >
      <BreakdownTable
        headers={["Product", "Events", "Cost"]}
        widths={["50%", "25%", "25%"]}
      >
        {rows.map((r) => (
          <Table.Row key={r.product ?? "(null)"}>
            <Table.Cell>
              <Text className="truncate">{r.product ?? "(none)"}</Text>
            </Table.Cell>
            <Table.Cell>{r.event_count.toLocaleString()}</Table.Cell>
            <Table.Cell>{formatUsd(r.cost_usd)}</Table.Cell>
          </Table.Row>
        ))}
      </BreakdownTable>
    </UsageCard>
  );
}

export function InputSizeBreakdownCard({
  rows,
}: {
  rows: SpendAnalysisInputSizeRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <UsageCard
      icon={<Ruler size={14} className="text-(--gray-9)" />}
      title="By context size"
    >
      <BreakdownTable
        headers={["Input tokens", "Generations", "Cost", "Share", "Avg cost"]}
        widths={["24%", "20%", "18%", "16%", "22%"]}
      >
        {rows.map((r) => (
          <Table.Row key={r.bucket}>
            <Table.Cell>{r.bucket}</Table.Cell>
            <Table.Cell>{r.generation_count.toLocaleString()}</Table.Cell>
            <Table.Cell>{formatUsd(r.cost_usd)}</Table.Cell>
            <Table.Cell>{Math.round(r.share_of_scoped * 100)}%</Table.Cell>
            <Table.Cell>{formatUsd(r.avg_cost_per_generation)}</Table.Cell>
          </Table.Row>
        ))}
      </BreakdownTable>
    </UsageCard>
  );
}
