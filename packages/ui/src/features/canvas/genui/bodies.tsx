import { type ActionBinding, getByPath } from "@json-render/core";
import { useActions, useStateStore } from "@json-render/react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  Heading,
  Input,
  Label,
  Progress,
  ProgressIndicator,
  ProgressTrack,
  TableBody as QuillTableBody,
  Separator,
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from "@posthog/quill";
import {
  BarChart,
  LineChart,
  PieChart,
  type Series,
  Sparkline,
  useChartTheme,
} from "@posthog/quill-charts";
import { MarkdownRenderer } from "@posthog/ui/features/editor/components/MarkdownRenderer";
import { Box, Flex, Grid } from "@radix-ui/themes";
import { Fragment, type ReactNode, useId } from "react";
import rehypeSanitize from "rehype-sanitize";

// The agent's Badge palette (gray/green/red/amber/blue) mapped to Quill Badge's
// semantic variants. Keeps the catalog contract stable while rendering in Quill.
const BADGE_VARIANT: Record<
  NonNullable<BadgeProps["color"]>,
  "default" | "success" | "destructive" | "warning" | "info"
> = {
  gray: "default",
  green: "success",
  red: "destructive",
  amber: "warning",
  blue: "info",
};

// An element's event→action bindings (json-render `on` field). A single event
// (e.g. "click") maps to one action or a list run in order.
export type ElementOn = Record<string, ActionBinding | ActionBinding[]>;

function bindingPath(value: unknown): string | undefined {
  if (value && typeof value === "object" && "$bindState" in value) {
    const path = (value as { $bindState: unknown }).$bindState;
    return typeof path === "string" ? path : undefined;
  }
  return undefined;
}

function bindingsFor(
  on: ElementOn | undefined,
  event: string,
): ActionBinding[] {
  const b = on?.[event];
  if (!b) return [];
  return Array.isArray(b) ? b : [b];
}

// Presentational bodies for every catalog component, shared by both the view
// renderer (registry.tsx → createRenderer) and the edit renderer
// (EditRenderer.tsx). Keeping the JSX in one place guarantees the two surfaces
// stay pixel-identical.
//
// `ctx` lets the edit renderer inject behaviour without the bodies knowing
// about editing: `text` wraps an editable static string, `data` wraps a locked
// query-derived value. In view mode both are pass-throughs (PLAIN_CTX).

export interface BodyCtx {
  /** Editable static text — inline editor in edit mode, plain text in view. */
  text: (propPath: string, value: string) => ReactNode;
  /** Locked data value — a "from query" hint in edit mode, plain in view. */
  data: (node: ReactNode) => ReactNode;
}

export const PLAIN_CTX: BodyCtx = {
  text: (_propPath, value) => value,
  data: (node) => node,
};

export interface PageProps {
  title?: string;
}
export interface GridProps {
  columns?: number;
}
export interface CardProps {
  title?: string;
}
export interface HeadingProps {
  text: string;
  level?: number;
}
export interface TextProps {
  text: string;
  muted?: boolean;
}
export interface StatProps {
  label: string;
  value: string | number;
  delta?: string;
}
export interface TableProps {
  columns: string[];
  rows: (string | number)[][];
}
export interface BarListProps {
  items: { label: string; value: number }[];
}
export interface BadgeProps {
  text: string;
  color?: "gray" | "green" | "red" | "amber" | "blue";
}
export type CanvasTone = "default" | "muted" | "accent" | "contrast";

// Constrained, theme-aware backgrounds (no arbitrary CSS) so agent-built pages
// stay on-brand and dark-mode-safe. Maps a tone to bg + text classes.
const TONE_CLASS: Record<CanvasTone, string> = {
  default: "",
  muted: "bg-gray-3 text-gray-12",
  accent: "bg-accent-3 text-gray-12",
  contrast: "bg-gray-12 text-gray-1",
};

function toneClass(tone?: CanvasTone): string {
  return TONE_CLASS[tone ?? "default"];
}

export interface HeroProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  ctaText?: string;
  tone?: CanvasTone;
}
export interface SectionProps {
  tone?: CanvasTone;
}
export interface MarkdownProps {
  content: string;
}
export interface ButtonProps {
  text: string;
  variant?: "primary" | "default" | "outline" | "destructive";
}
export interface TextInputProps {
  label?: string;
  placeholder?: string;
  value?: string;
}
export interface CheckboxProps {
  label: string;
  checked?: boolean;
}
export interface ChartSeriesInput {
  label: string;
  data: number[];
}
export interface LineChartProps {
  labels: string[];
  series: ChartSeriesInput[];
}
export interface BarChartProps {
  labels: string[];
  series: ChartSeriesInput[];
}
export interface SparklineProps {
  data: number[];
}
export interface PieChartProps {
  items: { label: string; value: number }[];
}
export interface ProgressProps {
  label?: string;
  value: number;
}
export interface HeatmapProps {
  rows: string[];
  cols: string[];
  cells: number[][];
}
export interface RetentionGridProps {
  periods: string[];
  cohorts: { label: string; size: number; values: number[] }[];
}

export function PageBody({
  children,
}: {
  props: PageProps;
  children?: ReactNode;
  ctx: BodyCtx;
}) {
  // The canvas title is the first child h1 Heading (the file-name source), so the
  // Page's own `title` prop is intentionally NOT rendered — rendering both showed
  // the title twice. Prop kept on the type for back-compat; it's just inert.
  return <div className="flex flex-col gap-6 p-4">{children}</div>;
}

export function GridBody({
  props,
  children,
}: {
  props: GridProps;
  children?: ReactNode;
  ctx: BodyCtx;
}) {
  return (
    // align="stretch" so cards in the same row share the row's height (a chart
    // card next to a taller table card fills, instead of floating short).
    <Grid
      columns={String(props.columns ?? 2)}
      gap="3"
      width="auto"
      align="stretch"
    >
      {children}
    </Grid>
  );
}

export function CardBody({
  props,
  children,
  ctx,
}: {
  props: CardProps;
  children?: ReactNode;
  ctx: BodyCtx;
}) {
  return (
    // h-full + flex column so the card fills its (stretched) grid cell and its
    // content region (flex-1) can grow — charts fill, tables get a tall scroll box.
    <Card size="sm" className="flex h-full flex-col">
      {props.title && (
        <CardHeader>
          <Heading size="lg" className="font-bold text-foreground">
            {ctx.text("/title", asText(props.title))}
          </Heading>
        </CardHeader>
      )}
      <CardContent className="flex flex-1 flex-col gap-4">
        {children}
      </CardContent>
    </Card>
  );
}

export function HeadingBody({
  props,
  ctx,
}: {
  props: HeadingProps;
  ctx: BodyCtx;
}) {
  return (
    <Heading
      size={props.level === 1 ? "2xl" : props.level === 3 ? "base" : "sm"}
      className="font-bold text-gray-12"
    >
      {ctx.text("/text", asText(props.text))}
    </Heading>
  );
}

export function TextBody({ props, ctx }: { props: TextProps; ctx: BodyCtx }) {
  return (
    <Text
      size="sm"
      render={<p />}
      className={props.muted ? "text-muted-foreground" : "text-foreground"}
    >
      {ctx.text("/text", asText(props.text))}
    </Text>
  );
}

const numberFormat = new Intl.NumberFormat();

// Spec props must be literal strings/numbers — this renderer doesn't resolve
// json-render bindings ({$state}/{$item}/{$bindItem}). If the agent emits one
// anyway, render nothing rather than letting React throw "Objects are not valid
// as a React child" and blanking the whole canvas.
function asText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return numberFormat.format(value as number | bigint);
  }
  return "";
}

// Group raw numbers (e.g. 34980058 → 34,980,058); leave pre-formatted strings.
function formatStatValue(value: unknown): string {
  return typeof value === "number" ? numberFormat.format(value) : asText(value);
}

export function StatBody({ props, ctx }: { props: StatProps; ctx: BodyCtx }) {
  return (
    <Flex direction="column" gap="1">
      <Label className="text-muted-foreground">
        {ctx.text("/label", asText(props.label))}
      </Label>
      <Heading size="2xl" className="font-bold text-gray-12">
        {ctx.data(formatStatValue(props.value))}
      </Heading>
      {props.delta && (
        <Text size="sm" className="text-gray-10">
          {ctx.data(asText(props.delta))}
        </Text>
      )}
    </Flex>
  );
}

export function TableBody({ props }: { props: TableProps; ctx: BodyCtx }) {
  return (
    // quill's scroll viewport is the INNER `[data-slot=table-viewport]` div
    // (overflow:auto, height:100%) — `className` lands on the outer root, where a
    // `max-h` can't make it scroll (the viewport's % height can't resolve against
    // a max-height). So cap the viewport itself; stickyHeader then pins as it scrolls.
    <Table
      stickyHeader
      className="rounded-md border border-border **:data-[slot=table-viewport]:max-h-72"
    >
      <TableHeader>
        <TableRow>
          {props.columns.map((col) => (
            <TableHead key={asText(col)}>{asText(col)}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <QuillTableBody>
        {props.rows.map((row, ri) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: spec rows have no id
          <TableRow key={ri}>
            {row.map((cell, ci) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: spec cells have no id
              <TableCell key={ci}>{asText(cell)}</TableCell>
            ))}
          </TableRow>
        ))}
      </QuillTableBody>
    </Table>
  );
}

export function BarListBody({ props }: { props: BarListProps; ctx: BodyCtx }) {
  const items = props.items;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <Flex direction="column" gap="2">
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: spec items have no id
        <Flex key={i} align="center" gap="2">
          <Box className="relative h-6 flex-1 overflow-hidden rounded bg-muted">
            <Box
              className="absolute inset-y-0 left-0 rounded bg-accent-5"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
            <Text
              size="sm"
              className="absolute inset-y-0 left-2 flex items-center"
            >
              {asText(item.label)}
            </Text>
          </Box>
          <Text
            size="sm"
            weight="semibold"
            className="min-w-12 shrink-0 whitespace-nowrap text-right font-mono tabular-nums"
          >
            {asText(item.value)}
          </Text>
        </Flex>
      ))}
    </Flex>
  );
}

export function BadgeBody({ props, ctx }: { props: BadgeProps; ctx: BodyCtx }) {
  return (
    <Badge variant={BADGE_VARIANT[props.color ?? "gray"]}>
      {ctx.text("/text", asText(props.text))}
    </Badge>
  );
}

// Map the LLM-friendly { label, data } catalog shape to quill-charts `Series`.
// `key` keys React/stacked lookups; fall back to the index when labels collide.
function toSeries(series: ChartSeriesInput[]): Series[] {
  return (series ?? []).map((s, i) => ({
    key: s.label || `series-${i}`,
    label: s.label,
    data: s.data ?? [],
  }));
}

export function LineChartBody({
  props,
}: {
  props: LineChartProps;
  ctx: BodyCtx;
}) {
  const theme = useChartTheme();
  // The chart root is `flex:1 1 0`, so it must fill a flex column with a
  // definite height — a plain block lets it collapse to nothing.
  return (
    <Box className="flex min-h-64 w-full flex-1 flex-col">
      <LineChart
        labels={props.labels ?? []}
        series={toSeries(props.series)}
        theme={theme}
      />
    </Box>
  );
}

export function BarChartBody({
  props,
}: {
  props: BarChartProps;
  ctx: BodyCtx;
}) {
  const theme = useChartTheme();
  return (
    <Box className="flex min-h-64 w-full flex-1 flex-col">
      <BarChart
        labels={props.labels ?? []}
        series={toSeries(props.series)}
        theme={theme}
      />
    </Box>
  );
}

export function SparklineBody({
  props,
}: {
  props: SparklineProps;
  ctx: BodyCtx;
}) {
  const theme = useChartTheme();
  // Sparkline sizes itself via its `height` prop (no flex container needed).
  return (
    <Box className="w-full">
      <Sparkline data={props.data ?? []} theme={theme} height={48} />
    </Box>
  );
}

export function PieChartBody({
  props,
}: {
  props: PieChartProps;
  ctx: BodyCtx;
}) {
  const theme = useChartTheme();
  // Each item is one slice: map to a single-value series (PieChart derives the
  // slice magnitude from the series, so data: [value] is enough).
  const series: Series[] = (props.items ?? []).map((it, i) => ({
    key: it.label || `slice-${i}`,
    label: it.label,
    data: [it.value],
  }));
  return (
    <Box className="flex min-h-64 w-full flex-1 flex-col">
      <PieChart series={series} theme={theme} />
    </Box>
  );
}

export function ProgressBody({
  props,
  ctx,
}: {
  props: ProgressProps;
  ctx: BodyCtx;
}) {
  const value = Math.max(0, Math.min(100, Number(props.value) || 0));
  return (
    <Flex direction="column" gap="1">
      {props.label && (
        <Flex align="center" justify="between">
          <Text size="sm" className="text-gray-11">
            {ctx.text("/label", asText(props.label))}
          </Text>
          <Text size="sm" className="text-gray-11 tabular-nums">
            {value}%
          </Text>
        </Flex>
      )}
      <Progress value={value}>
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      </Progress>
    </Flex>
  );
}

// Compact number for dense grid cells (6020 → "6K", 1_360_000 → "1.4M").
const compactNumber = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function HeatmapBody({ props }: { props: HeatmapProps; ctx: BodyCtx }) {
  const rows = props.rows ?? [];
  const cols = props.cols ?? [];
  const cells = props.cells ?? [];
  const max = Math.max(1, ...cells.flat().map((v) => Number(v) || 0));
  return (
    <Box className="w-full overflow-x-auto">
      <Box
        className="grid gap-0.5"
        style={{
          gridTemplateColumns: `auto repeat(${cols.length}, minmax(2rem, 1fr))`,
        }}
      >
        {/* Header: empty corner + column labels. */}
        <Box />
        {cols.map((col, ci) => (
          <Text
            // biome-ignore lint/suspicious/noArrayIndexKey: heatmap cols have no id
            key={ci}
            size="xs"
            className="text-center text-muted-foreground tabular-nums"
          >
            {asText(col)}
          </Text>
        ))}
        {rows.map((row, ri) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: heatmap rows have no id
          <Fragment key={ri}>
            <Text size="xs" className="pr-2 text-muted-foreground">
              {asText(row)}
            </Text>
            {cols.map((_col, ci) => {
              const v = Number(cells[ri]?.[ci]) || 0;
              return (
                <Flex
                  // biome-ignore lint/suspicious/noArrayIndexKey: heatmap cells have no id
                  key={ci}
                  align="center"
                  justify="center"
                  className="h-7 rounded-sm bg-accent-9 text-[10px] text-gray-12 tabular-nums"
                  // Intensity by value: a floor so low cells stay visible.
                  style={{ opacity: 0.12 + 0.88 * (v / max) }}
                >
                  {v > 0 ? compactNumber.format(v) : ""}
                </Flex>
              );
            })}
          </Fragment>
        ))}
      </Box>
    </Box>
  );
}

export function RetentionGridBody({
  props,
}: {
  props: RetentionGridProps;
  ctx: BodyCtx;
}) {
  const periods = props.periods ?? [];
  const cohorts = props.cohorts ?? [];
  return (
    <Table
      stickyHeader
      className="rounded-md border border-border **:data-[slot=table-viewport]:max-h-96"
    >
      <TableHeader>
        <TableRow>
          <TableHead>Cohort</TableHead>
          <TableHead>Size</TableHead>
          {periods.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: periods have no id
            <TableHead key={i}>{asText(p)}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <QuillTableBody>
        {cohorts.map((cohort, ci) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: cohorts have no id
          <TableRow key={ci}>
            <TableCell>{asText(cohort.label)}</TableCell>
            <TableCell className="tabular-nums">
              {asText(cohort.size)}
            </TableCell>
            {periods.map((_p, pi) => {
              const pct = Math.max(
                0,
                Math.min(100, Number(cohort.values?.[pi]) || 0),
              );
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: cells have no id
                <TableCell key={pi}>
                  <Box className="relative h-6 min-w-16 overflow-hidden rounded bg-muted">
                    <Box
                      className="absolute inset-y-0 left-0 bg-accent-9"
                      style={{ width: `${pct}%` }}
                    />
                    <Flex
                      align="center"
                      justify="center"
                      className="absolute inset-0 text-[11px] text-gray-12 tabular-nums"
                    >
                      {pct.toFixed(1)}%
                    </Flex>
                  </Box>
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </QuillTableBody>
    </Table>
  );
}

export function SectionBody({
  props,
  children,
}: {
  props: SectionProps;
  children?: ReactNode;
  ctx: BodyCtx;
}) {
  return (
    <Box className={`rounded-xl px-6 py-8 ${toneClass(props.tone)}`}>
      <Flex direction="column" gap="4">
        {children}
      </Flex>
    </Box>
  );
}

export function HeroBody({ props, ctx }: { props: HeroProps; ctx: BodyCtx }) {
  return (
    <Flex
      direction="column"
      align="center"
      gap="3"
      py="8"
      className={`rounded-xl px-6 text-center ${toneClass(props.tone)}`}
    >
      {props.eyebrow && (
        <Text size="sm" weight="semibold" className="text-accent-11 uppercase">
          {ctx.text("/eyebrow", asText(props.eyebrow))}
        </Text>
      )}
      <Heading size="2xl" className="max-w-3xl text-balance text-gray-12">
        {ctx.text("/title", asText(props.title))}
      </Heading>
      {props.subtitle && (
        <Text size="base" className="max-w-2xl text-pretty text-gray-10">
          {ctx.text("/subtitle", asText(props.subtitle))}
        </Text>
      )}
      {props.ctaText && (
        <Button variant="primary" size="lg" className="mt-2">
          {ctx.text("/ctaText", asText(props.ctaText))}
        </Button>
      )}
    </Flex>
  );
}

export function MarkdownBody({
  props,
}: {
  props: MarkdownProps;
  ctx: BodyCtx;
}) {
  return (
    <Box className="text-gray-12">
      {/* Sanitized: Markdown only, raw HTML is stripped (untrusted agent text). */}
      <MarkdownRenderer
        content={asText(props.content)}
        rehypePlugins={[rehypeSanitize]}
      />
    </Box>
  );
}

export function ButtonBody({
  props,
  on,
  ctx,
}: {
  props: ButtonProps;
  on?: ElementOn;
  ctx: BodyCtx;
}) {
  const actions = useActions();
  const clickBindings = bindingsFor(on, "click");
  const onClick =
    clickBindings.length > 0
      ? () => {
          for (const binding of clickBindings) void actions.execute(binding);
        }
      : undefined;
  return (
    <Button variant={props.variant ?? "primary"} onClick={onClick}>
      {ctx.text("/text", asText(props.text))}
    </Button>
  );
}

// Two-way text field. When `value` is `{ $bindState: "/path" }` it reads from /
// writes to the state store (controlled). Without a binding it falls back to an
// uncontrolled field so the user can still type (value just isn't persisted).
// NB: unlike createRenderer, our manual walk does NOT pre-resolve the bound
// value, so we read it from the store here — `useBoundProp` only echoes the prop
// it's handed and would leave the field frozen.
export function TextInputBody({
  props,
}: {
  props: TextInputProps;
  ctx: BodyCtx;
}) {
  const { state, set } = useStateStore();
  const path = bindingPath((props as { value?: unknown }).value);
  const bound = path !== undefined;
  const value = bound
    ? ((getByPath(state, path) as string | undefined) ?? "")
    : undefined;
  return (
    <Flex direction="column" gap="1">
      {props.label && <Text size="sm">{asText(props.label)}</Text>}
      <Input
        value={value}
        defaultValue={bound ? undefined : asText(props.value)}
        placeholder={props.placeholder}
        onChange={bound ? (e) => set(path, e.target.value) : undefined}
      />
    </Flex>
  );
}

export function CheckboxBody({
  props,
}: {
  props: CheckboxProps;
  ctx: BodyCtx;
}) {
  const id = useId();
  const { state, set } = useStateStore();
  const path = bindingPath((props as { checked?: unknown }).checked);
  const bound = path !== undefined;
  const checked = bound
    ? getByPath(state, path) === true
    : props.checked === true;
  return (
    <Flex align="center" gap="2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={bound ? (c) => set(path, c === true) : undefined}
      />
      <Label htmlFor={id} className="text-foreground">
        {asText(props.label)}
      </Label>
    </Flex>
  );
}

export function DividerBody() {
  return <Separator />;
}

// Dispatch a spec element (untyped JSON props) to its presentational body.
// Shared by the edit and view renderers.
export function renderBody(
  type: string,
  props: Record<string, unknown>,
  children: ReactNode,
  ctx: BodyCtx,
  on?: ElementOn,
): ReactNode {
  const p = props as never;
  switch (type) {
    case "Page":
      return (
        <PageBody props={p} ctx={ctx}>
          {children}
        </PageBody>
      );
    case "Grid":
      return (
        <GridBody props={p} ctx={ctx}>
          {children}
        </GridBody>
      );
    case "Card":
      return (
        <CardBody props={p} ctx={ctx}>
          {children}
        </CardBody>
      );
    case "Heading":
      return <HeadingBody props={p} ctx={ctx} />;
    case "Text":
      return <TextBody props={p} ctx={ctx} />;
    case "Stat":
      return <StatBody props={p} ctx={ctx} />;
    case "Table":
      return <TableBody props={p} ctx={ctx} />;
    case "BarList":
      return <BarListBody props={p} ctx={ctx} />;
    case "LineChart":
      return <LineChartBody props={p} ctx={ctx} />;
    case "BarChart":
      return <BarChartBody props={p} ctx={ctx} />;
    case "Sparkline":
      return <SparklineBody props={p} ctx={ctx} />;
    case "PieChart":
      return <PieChartBody props={p} ctx={ctx} />;
    case "Progress":
      return <ProgressBody props={p} ctx={ctx} />;
    case "Heatmap":
      return <HeatmapBody props={p} ctx={ctx} />;
    case "RetentionGrid":
      return <RetentionGridBody props={p} ctx={ctx} />;
    case "Badge":
      return <BadgeBody props={p} ctx={ctx} />;
    case "Section":
      return (
        <SectionBody props={p} ctx={ctx}>
          {children}
        </SectionBody>
      );
    case "Hero":
      return <HeroBody props={p} ctx={ctx} />;
    case "Markdown":
      return <MarkdownBody props={p} ctx={ctx} />;
    case "Button":
      return <ButtonBody props={p} on={on} ctx={ctx} />;
    case "TextInput":
      return <TextInputBody props={p} ctx={ctx} />;
    case "Checkbox":
      return <CheckboxBody props={p} ctx={ctx} />;
    case "Divider":
      return <DividerBody />;
    default:
      return null;
  }
}
