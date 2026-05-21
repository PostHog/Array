import { useSpendAnalysis } from "@features/billing/hooks/useSpendAnalysis";
import type {
  SpendAnalysisModelRow,
  SpendAnalysisProductRow,
  SpendAnalysisResponse,
  SpendAnalysisToolRow,
  SpendAnalysisTraceRow,
} from "@features/billing/types/spend-analysis";
import {
  ArrowSquareOut,
  ChartLine,
  Lightning,
  WarningCircle,
} from "@phosphor-icons/react";
import { Button, Callout, Flex, Spinner, Table, Text } from "@radix-ui/themes";

const DOCS_URL = "https://posthog.com/docs/llm-analytics";
const SKILL_URL =
  "https://github.com/PostHog/posthog/blob/master/products/llm_analytics/skills/exploring-llm-costs/SKILL.md";

function formatUsd(amount: number): string {
  if (amount === 0) return "$0";
  if (amount < 0.01) return "<$0.01";
  if (amount < 100) return `$${amount.toFixed(2)}`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toString();
}

function formatTrace(traceId: string | null): string {
  if (!traceId) return "(no trace id)";
  if (traceId.length <= 14) return traceId;
  return `${traceId.slice(0, 8)}…${traceId.slice(-4)}`;
}

function formatWindow(fromIso: string, toIso: string): string {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  const days = Math.max(1, Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24)));
  return `${days} days`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function generateSuggestions(data: SpendAnalysisResponse): string[] {
  const suggestions: string[] = [];
  const { summary } = data;
  const toolItems = data.by_tool.items;
  const traceItems = data.top_traces.items;

  if (summary.total_cost_usd === 0) {
    return ["No LLM spend in the selected window."];
  }

  const codeShare =
    summary.scoped_cost_usd / Math.max(summary.total_cost_usd, 0.0001);
  if (codeShare > 0.7) {
    suggestions.push(
      `PostHog Code is ${Math.round(codeShare * 100)}% of your spend. Other AI products (background agents, posthog_ai) are minor here.`,
    );
  }

  const codeTotal = summary.scoped_cost_usd;
  // codeTotal is the scoped spend (PostHog Code, since the banner always
  // requests `product=posthog_code`).
  if (codeTotal > 0 && toolItems.length > 0) {
    const top = toolItems[0];
    if (top.share_of_scoped > 0.35 && top.tool) {
      suggestions.push(
        `${top.tool} drives ${Math.round(top.share_of_scoped * 100)}% of your PostHog Code spend — averaging ${formatTokens(top.avg_input_tokens)} input tokens per call.`,
      );
    }
    const noToolRow = toolItems.find((r) => r.tool === null);
    if (noToolRow && noToolRow.share_of_scoped > 0.1) {
      suggestions.push(
        `${Math.round(noToolRow.share_of_scoped * 100)}% is spent on generations that take no tool action — pure text replies. Consider tighter prompts or stopping the agent earlier.`,
      );
    }
  }

  if (traceItems.length > 0 && codeTotal > 0) {
    const topTrace = traceItems[0];
    const share = topTrace.cost_usd / codeTotal;
    if (share > 0.15) {
      suggestions.push(
        `Your top session cost ${formatUsd(topTrace.cost_usd)} — ${Math.round(share * 100)}% of PostHog Code spend in one trace. Long sessions compound context cost.`,
      );
    }
  }

  if (suggestions.length === 0) {
    suggestions.push(
      "Your spend is fairly evenly distributed across tools and sessions — no single hotspot stands out.",
    );
  }

  return suggestions;
}

function SummaryRow({ data }: { data: SpendAnalysisResponse }) {
  const { summary } = data;
  const codeShare =
    summary.total_cost_usd > 0
      ? Math.round((summary.scoped_cost_usd / summary.total_cost_usd) * 100)
      : 0;
  return (
    <Flex gap="4" wrap="wrap">
      <StatCard label="Total spend" value={formatUsd(summary.total_cost_usd)} />
      <StatCard
        label="PostHog Code"
        value={formatUsd(summary.scoped_cost_usd)}
        sub={`${codeShare}% of total`}
      />
      <StatCard
        label="Generations"
        value={summary.scoped_event_count.toLocaleString()}
      />
      <StatCard
        label="Window"
        value={formatWindow(summary.date_from, summary.date_to)}
      />
    </Flex>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Flex
      direction="column"
      gap="1"
      p="3"
      className="min-w-[110px] flex-1 rounded-(--radius-3) border border-(--gray-5)"
    >
      <Text className="text-(--gray-9) text-[12px] uppercase tracking-wide">
        {label}
      </Text>
      <Text className="font-semibold text-base">{value}</Text>
      {sub && <Text className="text-(--gray-9) text-[12px]">{sub}</Text>}
    </Flex>
  );
}

function ProductTable({ rows }: { rows: SpendAnalysisProductRow[] }) {
  if (rows.length === 0) return null;
  return (
    <SectionTable
      title="By ai_product"
      headers={["Product", "Events", "Cost"]}
      widths={["50%", "25%", "25%"]}
    >
      {rows.map((r) => (
        <Table.Row key={r.product ?? "(null)"}>
          <Table.Cell>{r.product ?? "(none)"}</Table.Cell>
          <Table.Cell>{r.event_count.toLocaleString()}</Table.Cell>
          <Table.Cell>{formatUsd(r.cost_usd)}</Table.Cell>
        </Table.Row>
      ))}
    </SectionTable>
  );
}

function ToolTable({ rows }: { rows: SpendAnalysisToolRow[] }) {
  if (rows.length === 0) return null;
  return (
    <SectionTable
      title="By tool (PostHog Code)"
      headers={["Tool", "Generations", "Avg input", "Cost"]}
      widths={["40%", "20%", "20%", "20%"]}
    >
      {rows.slice(0, 10).map((r) => (
        <Table.Row key={r.tool ?? "(null)"}>
          <Table.Cell>{r.tool ?? "(no tool)"}</Table.Cell>
          <Table.Cell>{r.generation_count.toLocaleString()}</Table.Cell>
          <Table.Cell>{formatTokens(r.avg_input_tokens)}</Table.Cell>
          <Table.Cell>{formatUsd(r.cost_usd)}</Table.Cell>
        </Table.Row>
      ))}
    </SectionTable>
  );
}

function ModelTable({ rows }: { rows: SpendAnalysisModelRow[] }) {
  if (rows.length === 0) return null;
  return (
    <SectionTable
      title="By model (PostHog Code)"
      headers={["Model", "Generations", "Input", "Output", "Cost"]}
      widths={["35%", "15%", "20%", "15%", "15%"]}
    >
      {rows.map((r) => (
        <Table.Row key={r.model ?? "(null)"}>
          <Table.Cell>{r.model ?? "(unknown)"}</Table.Cell>
          <Table.Cell>{r.generation_count.toLocaleString()}</Table.Cell>
          <Table.Cell>{formatTokens(r.input_tokens)}</Table.Cell>
          <Table.Cell>{formatTokens(r.output_tokens)}</Table.Cell>
          <Table.Cell>{formatUsd(r.cost_usd)}</Table.Cell>
        </Table.Row>
      ))}
    </SectionTable>
  );
}

function TraceTable({ rows }: { rows: SpendAnalysisTraceRow[] }) {
  if (rows.length === 0) return null;
  return (
    <SectionTable
      title="Top traces"
      headers={["Trace", "Generations", "Started", "Cost"]}
      widths={["40%", "20%", "20%", "20%"]}
    >
      {rows.map((r) => (
        <Table.Row key={r.trace_id ?? "(null)"}>
          <Table.Cell>
            <Text className="font-mono text-[12px]">
              {formatTrace(r.trace_id)}
            </Text>
          </Table.Cell>
          <Table.Cell>{r.generation_count.toLocaleString()}</Table.Cell>
          <Table.Cell>{formatDate(r.started_at)}</Table.Cell>
          <Table.Cell>{formatUsd(r.cost_usd)}</Table.Cell>
        </Table.Row>
      ))}
    </SectionTable>
  );
}

function SectionTable({
  title,
  headers,
  widths,
  children,
}: {
  title: string;
  headers: string[];
  widths: string[];
  children: React.ReactNode;
}) {
  return (
    <Flex direction="column" gap="2">
      <Text className="font-medium text-(--gray-9) text-sm">{title}</Text>
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
    </Flex>
  );
}

function FooterLinks() {
  return (
    <Flex direction="column" gap="1">
      <Text className="text-(--gray-11) text-[13px]">
        Use{" "}
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="text-(--accent-11) underline"
        >
          PostHog LLM analytics
        </a>{" "}
        in your own project for the full slice-and-dice experience.
      </Text>
      <Text className="text-(--gray-11) text-[13px]">
        Want an agent to run this kind of analysis on demand? Drop the{" "}
        <a
          href={SKILL_URL}
          target="_blank"
          rel="noreferrer"
          className="text-(--accent-11) underline"
        >
          exploring-llm-costs
        </a>{" "}
        skill into your agent.
      </Text>
    </Flex>
  );
}

export function TokenSpendAnalysisBanner() {
  const { data, isLoading, error, run } = useSpendAnalysis();
  const triggerRun = (): void => {
    void run({ dateFrom: "-30d", product: "posthog_code" });
  };

  if (data) {
    const suggestions = generateSuggestions(data);
    return (
      <Flex direction="column" gap="4">
        <Flex
          align="center"
          gap="2"
          p="3"
          className="rounded-(--radius-3) border border-(--accent-7) bg-(--accent-2)"
        >
          <ChartLine size={16} className="text-(--accent-9)" />
          <Text className="font-medium text-sm">
            Your PostHog Code token spend (last 30 days)
          </Text>
          <Flex flexGrow="1" />
          <Button
            size="1"
            variant="ghost"
            disabled={isLoading}
            onClick={() => {
              triggerRun();
            }}
          >
            {isLoading ? <Spinner size="1" /> : "Refresh"}
          </Button>
        </Flex>
        <SummaryRow data={data} />
        <ProductTable rows={data.by_product.items} />
        <ToolTable rows={data.by_tool.items} />
        <ModelTable rows={data.by_model.items} />
        <TraceTable rows={data.top_traces.items} />
        <Flex
          direction="column"
          gap="2"
          p="3"
          className="rounded-(--radius-3) border border-(--gray-5)"
        >
          <Flex align="center" gap="2">
            <Lightning size={14} className="text-(--accent-9)" />
            <Text className="font-medium text-sm">Where to look</Text>
          </Flex>
          {suggestions.map((s) => (
            <Text key={s} className="text-(--gray-11) text-[13px]">
              {s}
            </Text>
          ))}
        </Flex>
        <FooterLinks />
      </Flex>
    );
  }

  if (error) {
    return (
      <Callout.Root color="red" size="1">
        <Callout.Icon>
          <WarningCircle size={16} />
        </Callout.Icon>
        <Callout.Text>
          <Flex direction="column" gap="2">
            <Text className="text-sm">Couldn't load spend analysis</Text>
            <Text className="text-(--gray-11) text-[13px]">{error}</Text>
            <Button
              size="1"
              variant="outline"
              color="red"
              onClick={() => {
                triggerRun();
              }}
              className="self-start"
            >
              Try again
            </Button>
          </Flex>
        </Callout.Text>
      </Callout.Root>
    );
  }

  return (
    <Callout.Root color="blue" size="1">
      <Callout.Icon>
        <ChartLine size={16} />
      </Callout.Icon>
      <Callout.Text>
        <Flex direction="column" gap="2">
          <Text className="font-medium text-sm">
            Analyse your token usage with PostHog LLM analytics
          </Text>
          <Text className="text-(--gray-11) text-[13px]">
            See where your spend goes — by tool, by model, by trace — over the
            last 30 days, and get tips on where to optimise.
          </Text>
          <Button
            size="1"
            variant="solid"
            disabled={isLoading}
            onClick={() => {
              triggerRun();
            }}
            className="self-start"
          >
            {isLoading ? <Spinner size="1" /> : "Analyse my spend"}
            {!isLoading && <ArrowSquareOut size={12} />}
          </Button>
        </Flex>
      </Callout.Text>
    </Callout.Root>
  );
}
