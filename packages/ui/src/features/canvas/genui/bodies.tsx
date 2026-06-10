import { Badge, Box, Flex, Grid, Heading, Table, Text } from "@radix-ui/themes";
import type { ReactNode } from "react";

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

export function PageBody({
  props,
  children,
  ctx,
}: {
  props: PageProps;
  children?: ReactNode;
  ctx: BodyCtx;
}) {
  return (
    <Flex direction="column" gap="4" p="5">
      {props.title && (
        <Heading size="6" className="text-gray-12">
          {ctx.text("/title", props.title)}
        </Heading>
      )}
      {children}
    </Flex>
  );
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
    <Grid columns={String(props.columns ?? 2)} gap="3" width="auto">
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
    <Box className="rounded-lg border border-gray-6 bg-gray-1 p-4">
      {props.title && (
        <Text size="2" weight="bold" className="mb-2 block text-gray-12">
          {ctx.text("/title", props.title)}
        </Text>
      )}
      {children}
    </Box>
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
      size={props.level === 1 ? "6" : props.level === 3 ? "3" : "4"}
      className="text-gray-12"
    >
      {ctx.text("/text", props.text)}
    </Heading>
  );
}

export function TextBody({ props, ctx }: { props: TextProps; ctx: BodyCtx }) {
  return (
    <Text
      size="2"
      as="p"
      className={props.muted ? "text-gray-10" : "text-gray-12"}
    >
      {ctx.text("/text", props.text)}
    </Text>
  );
}

const numberFormat = new Intl.NumberFormat();

// Group raw numbers (e.g. 34980058 → 34,980,058); leave pre-formatted strings.
function formatStatValue(value: string | number): string {
  return typeof value === "number" ? numberFormat.format(value) : value;
}

export function StatBody({ props, ctx }: { props: StatProps; ctx: BodyCtx }) {
  return (
    <Flex direction="column" gap="1">
      <Text size="1" className="text-gray-10">
        {ctx.text("/label", props.label)}
      </Text>
      <Text size="7" weight="bold" className="text-gray-12">
        {ctx.data(formatStatValue(props.value))}
      </Text>
      {props.delta && (
        <Text size="1" className="text-gray-10">
          {ctx.data(props.delta)}
        </Text>
      )}
    </Flex>
  );
}

export function TableBody({ props }: { props: TableProps; ctx: BodyCtx }) {
  return (
    <Table.Root size="1" variant="surface">
      <Table.Header>
        <Table.Row>
          {props.columns.map((col) => (
            <Table.ColumnHeaderCell key={col}>{col}</Table.ColumnHeaderCell>
          ))}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {props.rows.map((row, ri) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: spec rows have no id
          <Table.Row key={ri}>
            {row.map((cell, ci) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: spec cells have no id
              <Table.Cell key={ci}>{String(cell)}</Table.Cell>
            ))}
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
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
          <Box className="relative h-6 flex-1 overflow-hidden rounded bg-gray-3">
            <Box
              className="absolute inset-y-0 left-0 rounded bg-accent-5"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
            <Text
              size="1"
              className="absolute inset-y-0 left-2 flex items-center text-gray-12"
            >
              {item.label}
            </Text>
          </Box>
          <Text size="1" weight="bold" className="w-12 text-right text-gray-11">
            {item.value}
          </Text>
        </Flex>
      ))}
    </Flex>
  );
}

export function BadgeBody({ props, ctx }: { props: BadgeProps; ctx: BodyCtx }) {
  return (
    <Badge color={props.color ?? "gray"}>{ctx.text("/text", props.text)}</Badge>
  );
}

export function DividerBody() {
  return <Box className="my-2 h-px bg-gray-6" />;
}

// Dispatch a spec element (untyped JSON props) to its presentational body.
// Shared by the edit and view renderers.
export function renderBody(
  type: string,
  props: Record<string, unknown>,
  children: ReactNode,
  ctx: BodyCtx,
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
    case "Badge":
      return <BadgeBody props={p} ctx={ctx} />;
    case "Divider":
      return <DividerBody />;
    default:
      return null;
  }
}
