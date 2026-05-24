import { useSpendAnalysis } from "@features/billing/hooks/useSpendAnalysis";
import type {
  SpendAnalysisModelRow,
  SpendAnalysisProductRow,
  SpendAnalysisResponse,
  SpendAnalysisToolRow,
} from "@features/billing/types/spend-analysis";
import { useSettingsDialogStore } from "@features/settings/stores/settingsDialogStore";
import {
  ArrowSquareOut,
  ChartLine,
  Lightning,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";
import { Button, Callout, Flex, Spinner, Table, Text } from "@radix-ui/themes";
import { useNavigationStore } from "@stores/navigationStore";

const DOCS_URL = "https://posthog.com/docs/llm-analytics";

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

function formatWindow(fromIso: string, toIso: string): string {
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();
  const days = Math.max(1, Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24)));
  return `${days} days`;
}

function generateSuggestions(data: SpendAnalysisResponse): string[] {
  const suggestions: string[] = [];
  const { summary } = data;
  const toolItems = data.by_tool.items;

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

  if (suggestions.length === 0) {
    suggestions.push(
      "Your spend is fairly evenly distributed across tools — no single hotspot stands out.",
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

/** Sanitises a value for safe inclusion in a markdown-table cell whose contents are then
 * fed to an LLM as a prompt.
 *
 * The spend data flows: event property -> backend aggregation -> this component -> markdown
 * table cell -> new task initialPrompt -> agent first turn. The receiving agent has full
 * tool access (Bash, Edit, Write, MCP), so any markdown structure that "escapes" the table
 * row -- newlines, fence markers, top-level headers -- can be read as a fresh instruction
 * block by the agent. We treat tool / model / product names as untrusted (an event property
 * captured by an SDK could carry attacker-influenced content in multi-tenant projects).
 *
 * - Pipe (`|`) is the only character that actually splits a markdown-table cell mid-row.
 * - Carriage return / line feed end the row and let following text look like a fresh
 *   paragraph or header (`\n\n## SYSTEM OVERRIDE` is the canonical injection shape).
 * - Backticks let an attacker open a fenced code block that swallows everything until
 *   the next backtick run.
 *
 * Replacing newlines/backticks with spaces (rather than escaping) keeps the cell readable
 * to a human reviewer while neutralising the structural attack. */
function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/[\r\n`]/g, " ");
}

/** Renders the spend data as a compact markdown report for the prefilled task prompt.
 *
 * Kept inline rather than reused for display because the in-banner tables already render
 * the same data with React. The markdown here exists so the *new* task has the numbers
 * in its prompt context without a second API round-trip. */
function buildAnalysisPrompt(data: SpendAnalysisResponse): string {
  const { summary } = data;
  const windowDays = formatWindow(summary.date_from, summary.date_to);

  const productRows = data.by_product.items
    .map(
      (r) =>
        `| ${escapeTableCell(r.product ?? "(none)")} | ${r.event_count.toLocaleString()} | ${formatUsd(r.cost_usd)} |`,
    )
    .join("\n");

  const toolRows = data.by_tool.items
    .slice(0, 10)
    .map(
      (r) =>
        `| ${escapeTableCell(r.tool ?? "(no tool)")} | ${r.generation_count.toLocaleString()} | ${formatTokens(r.avg_input_tokens)} | ${formatUsd(r.cost_usd)} |`,
    )
    .join("\n");

  const modelRows = data.by_model.items
    .map(
      (r) =>
        `| ${escapeTableCell(r.model ?? "(unknown)")} | ${r.generation_count.toLocaleString()} | ${formatTokens(r.input_tokens)} | ${formatTokens(r.output_tokens)} | ${formatUsd(r.cost_usd)} |`,
    )
    .join("\n");

  return `Here is my PostHog Code LLM spend for the last ${windowDays}. Help me understand what's driving the cost and what concrete changes I should make to reduce it.

Work only from the tables below — do **not** try to query PostHog LLM analytics or any external data source. The numbers here are everything you have. Rank advice by impact, lead with the biggest lever, and keep each suggestion concrete and actionable.

## My spend

### Summary
- Total spend: ${formatUsd(summary.total_cost_usd)}
- PostHog Code spend: ${formatUsd(summary.scoped_cost_usd)} (${summary.total_cost_usd > 0 ? Math.round((summary.scoped_cost_usd / summary.total_cost_usd) * 100) : 0}% of total)
- Generations: ${summary.scoped_event_count.toLocaleString()}
- Window: ${windowDays}

### By product
| Product | Events | Cost |
| --- | --- | --- |
${productRows || "| (none) | 0 | $0 |"}

### By tool (PostHog Code, top 10)
| Tool | Generations | Avg input | Cost |
| --- | --- | --- | --- |
${toolRows || "| (none) | 0 | 0 | $0 |"}

### By model (PostHog Code)
| Model | Generations | Input | Output | Cost |
| --- | --- | --- | --- | --- |
${modelRows || "| (none) | 0 | 0 | 0 | $0 |"}

## What to look at

Use this playbook to interpret the numbers above. Apply the levers in order of impact; not every lever applies to every user.

1. **Input tokens are the bill, not the tool calls themselves.** "Avg input" per tool is the context size dragged along on every call. A tool like Bash being expensive almost never means Bash is expensive — it means there were many Bash calls each carrying a fat context. The biggest lever is conversation length, not which tool gets called: \`/compact\` aggressively at logical checkpoints, start fresh sessions for unrelated tasks, avoid backtracking ("actually try X instead") because that re-runs all the prior context plus the alternative.

2. **Model choice.** Look at the "By model" table. If most generations are on the most expensive model (e.g. Opus tier), switching the default to a mid-tier model (e.g. Sonnet) and only escalating for genuinely hard reasoning is often the single biggest dollar saver. The cheapest tier (Haiku) is essentially free per call for routine "run the test" / "git status" / "grep this" work.

3. **Subagent hygiene.** The Agent tool typically has a high avg input because subagents inherit a brief plus tool definitions. They're worth their cost when they protect the main conversation from a long exploration; they're not worth it for "read one file" or "grep one pattern" — use the direct tool.

4. **(no tool) share.** The "(no tool)" row in the By tool table is the model replying with pure text — no action. Some of that is unavoidable (answering a question), some is the model thinking out loud or asking clarifying questions when it could just act. If this share is >10% of PostHog Code spend, more directive prompts ("Just do X" instead of "What do you think about X?") cut a round-trip per task.

5. **MCP registry overhead.** MCP tool calls (anything prefixed \`mcp__\`) ship the full registry of available MCP tools on every call. Tools with high avg input often signal a bloated registry. Prune unused MCP servers from \`.mcp.json\` to shrink the per-call overhead.

## Output

Give me a ranked list of recommendations. For each: what to do, the data point from the tables that motivates it, and a rough sense of the savings opportunity (a percentage of current spend if you can estimate it).
`;
}

function FooterLinks({ data }: { data: SpendAnalysisResponse }) {
  const navigateToTaskInput = useNavigationStore(
    (state) => state.navigateToTaskInput,
  );
  const closeSettings = useSettingsDialogStore((state) => state.close);

  const handleAnalyseClick = (): void => {
    // This banner lives inside the Settings dialog (modal). `navigateToTaskInput`
    // changes the underlying view but the dialog stays mounted on top, so the user
    // doesn't see the prefilled task input. Close the dialog first.
    closeSettings();
    navigateToTaskInput({
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
          PostHog LLM analytics
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
