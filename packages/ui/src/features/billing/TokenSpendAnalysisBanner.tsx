import {
  ArrowSquareOut,
  ChartLine,
  Lightning,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  formatTokens,
  formatUsd,
  formatWindow,
  windowDays,
} from "@posthog/core/billing/spendAnalysisFormat";
import { buildAnalysisPrompt } from "@posthog/core/billing/spendAnalysisPrompt";
import type {
  SpendAnalysisModelRow,
  SpendAnalysisProductRow,
  SpendAnalysisResponse,
  SpendAnalysisToolRow,
} from "@posthog/core/billing/spendAnalysisTypes";
import { deriveSpendSuggestions } from "@posthog/core/billing/spendSuggestions";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { useSpendAnalysis } from "@posthog/ui/features/billing/useSpendAnalysis";
import { closeSettings } from "@posthog/ui/features/settings/hooks/useOpenSettings";
import { openTaskInput } from "@posthog/ui/router/useOpenTask";
import { track } from "@posthog/ui/shell/analytics";
import { Button, Callout, Flex, Spinner, Table, Text } from "@radix-ui/themes";

const DOCS_URL = "https://posthog.com/docs/ai-observability";

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

function FooterLinks({ data }: { data: SpendAnalysisResponse }) {
  const handleAnalyseClick = (): void => {
    track(ANALYTICS_EVENTS.SPEND_ANALYSIS_TASK_OPENED, {
      total_cost_usd: data.summary.total_cost_usd,
      scoped_cost_usd: data.summary.scoped_cost_usd,
      scoped_event_count: data.summary.scoped_event_count,
      window_days: windowDays(data.summary.date_from, data.summary.date_to),
      tool_row_count: Math.min(data.by_tool.items.length, 10),
      model_row_count: data.by_model.items.length,
    });
    // This banner lives inside the Settings dialog (modal). `navigateToTaskInput`
    // changes the underlying view but the dialog stays mounted on top, so the user
    // doesn't see the prefilled task input. Close the dialog first.
    closeSettings();
    openTaskInput({
      initialPrompt: buildAnalysisPrompt(data),
    });
  };

  return (
    <Flex direction="column" gap="2">
      <Text className="text-(--gray-11) text-[13px]">
        Use{" "}
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="text-(--accent-11) underline"
        >
          PostHog AI observability
        </a>{" "}
        in your own project for the full slice-and-dice experience.
      </Text>
      <Button
        size="1"
        variant="soft"
        onClick={handleAnalyseClick}
        className="self-start"
      >
        <Sparkle size={12} />
        Open a task to analyse this with an agent
      </Button>
    </Flex>
  );
}

export function TokenSpendAnalysisBanner() {
  const { data, isLoading, error, run } = useSpendAnalysis();
  const triggerRun = (): void => {
    void run({ dateFrom: "-30d", product: "posthog_code" });
  };

  if (data) {
    const suggestions = deriveSpendSuggestions(data);
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
        <FooterLinks data={data} />
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
            Analyse your token usage with PostHog AI observability
          </Text>
          <Text className="text-(--gray-11) text-[13px]">
            See where your spend goes — by product, tool, and model — over the
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
