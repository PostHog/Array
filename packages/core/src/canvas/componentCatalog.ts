import { defineCatalog } from "@json-render/core";
import { z } from "zod";
import { canvasSchema } from "./canvasSchema";

// The component catalog the canvas agent may emit — the single source of truth
// shared by the renderer (which maps these names to React bodies in
// genui/registry.tsx) and the main-process services (which build each template's
// system prompt from `canvasCatalog.prompt(...)`). Keep components small and
// composable.
export const CANVAS_COMPONENTS = {
  Page: {
    props: z.object({ title: z.string().optional() }),
    slots: ["default"],
    description: "Top-level page container; a vertical stack of sections.",
  },
  Grid: {
    props: z.object({ columns: z.number().int().min(1).max(4).optional() }),
    slots: ["default"],
    description: "Responsive grid. Place Cards or Stats inside.",
  },
  Card: {
    props: z.object({ title: z.string().optional() }),
    slots: ["default"],
    description: "Bordered surface grouping related content.",
  },
  Heading: {
    props: z.object({
      text: z.string(),
      level: z.number().int().min(1).max(3).optional(),
    }),
    description: "A section heading (level 1 largest).",
  },
  Text: {
    props: z.object({ text: z.string(), muted: z.boolean().optional() }),
    description: "A paragraph of text.",
  },
  Stat: {
    props: z.object({
      label: z.string(),
      value: z.union([z.string(), z.number()]),
      delta: z.string().optional(),
    }),
    description: "A single big metric with a label and optional delta.",
  },
  Table: {
    props: z.object({
      columns: z.array(z.string()),
      rows: z.array(z.array(z.union([z.string(), z.number()]))),
    }),
    description: "A data table with column headers and rows.",
  },
  BarList: {
    props: z.object({
      items: z.array(z.object({ label: z.string(), value: z.number() })),
    }),
    description: "Horizontal bar list for ranked breakdowns.",
  },
  LineChart: {
    props: z.object({
      labels: z.array(z.string()),
      series: z.array(
        z.object({ label: z.string(), data: z.array(z.number()) }),
      ),
    }),
    description:
      "A line chart for trends over time. `labels` are the x-axis points; each series has a label and one value per label (data length MUST equal labels length).",
  },
  BarChart: {
    props: z.object({
      labels: z.array(z.string()),
      series: z.array(
        z.object({ label: z.string(), data: z.array(z.number()) }),
      ),
    }),
    description:
      "A bar chart (grouped when multiple series). `labels` are the x-axis categories; each series has a label and one value per label (data length MUST equal labels length).",
  },
  Sparkline: {
    props: z.object({ data: z.array(z.number()) }),
    description: "A tiny inline trend line — a row of numbers, no axes.",
  },
  PieChart: {
    props: z.object({
      items: z.array(z.object({ label: z.string(), value: z.number() })),
    }),
    description:
      "A pie chart showing share-of-total. Each item is one slice (label + value); the chart converts the values to percentages. Use for composition/breakdown, not trends over time.",
  },
  Progress: {
    props: z.object({
      label: z.string().optional(),
      value: z.number().min(0).max(100),
    }),
    description:
      "A horizontal progress bar showing percent toward a goal. `value` is 0–100; add an optional `label` to caption it (e.g. a quota or completion rate).",
  },
  Badge: {
    props: z.object({
      text: z.string(),
      color: z.enum(["gray", "green", "red", "amber", "blue"]).optional(),
    }),
    description: "A small status pill.",
  },
  Hero: {
    props: z.object({
      title: z.string(),
      eyebrow: z.string().optional(),
      subtitle: z.string().optional(),
      ctaText: z.string().optional(),
      tone: z.enum(["default", "muted", "accent", "contrast"]).optional(),
    }),
    description:
      "A centered hero section for the top of a page: a big title with an optional eyebrow, subtitle, and call-to-action label. `tone` sets the background: default (page), muted (subtle grey), accent (brand), contrast (dark).",
  },
  Section: {
    props: z.object({
      tone: z.enum(["default", "muted", "accent", "contrast"]).optional(),
    }),
    slots: ["default"],
    description:
      "A full-width band that groups content on a background. Set `tone` (default | muted | accent | contrast) and alternate bands down a page for rich visual rhythm. Place Headings, Text, Grids, Cards etc. inside.",
  },
  Markdown: {
    props: z.object({ content: z.string() }),
    description:
      "A rich-text block rendered from Markdown — headings, lists, links, bold/italic, tables. Use for prose-heavy content (landing-page copy, write-ups). Markdown only; no raw HTML.",
  },
  Button: {
    props: z.object({
      text: z.string(),
      variant: z
        .enum(["primary", "default", "outline", "destructive"])
        .optional(),
    }),
    description:
      'A button. For interactivity, add an `on.click` event binding to a built-in action, e.g. `"on": { "click": { "action": "setState", "params": { "statePath": "/submitted", "value": true } } }`.',
  },
  TextInput: {
    props: z.object({
      label: z.string().optional(),
      placeholder: z.string().optional(),
      value: z.string().optional(),
    }),
    description:
      'A single-line text field for forms. Make it a controlled form field by binding `value` to state two-way: `"value": { "$bindState": "/form/email" }`. Seed the initial value under the spec\'s top-level `state`.',
  },
  Checkbox: {
    props: z.object({
      label: z.string(),
      checked: z.boolean().optional(),
    }),
    description:
      'A labelled checkbox. Bind `checked` to state two-way for forms: `"checked": { "$bindState": "/form/agree" }`.',
  },
  Divider: {
    props: z.object({}),
    description: "A horizontal divider.",
  },
  Heatmap: {
    props: z.object({
      rows: z.array(z.string()),
      cols: z.array(z.string()),
      cells: z.array(z.array(z.number())),
    }),
    description:
      "A coloured heatmap grid (e.g. active hours: rows = days, cols = hours). `rows` label each row, `cols` label each column, and `cells[r][c]` is the value at that row/column — `cells` MUST have one inner array per row, each the same length as `cols`. Cell background intensity scales with the value. Good for day×hour activity grids; you may include an 'All' row/col of totals.",
  },
  RetentionGrid: {
    props: z.object({
      periods: z.array(z.string()),
      cohorts: z.array(
        z.object({
          label: z.string(),
          size: z.number(),
          values: z.array(z.number()),
        }),
      ),
    }),
    description:
      "A retention cohort grid. `periods` are the column headers (e.g. ['Week 0','Week 1']). Each cohort has a `label` (the cohort name/date range), a `size` (cohort population), and `values` — the retention PERCENTAGE (0–100) for each period, same length as `periods`. Each value renders as a filled bar whose width and colour scale with the percentage.",
  },
};

// Catalog built on the core-only schema, usable from both main-process services
// and the renderer.
export const canvasCatalog = defineCatalog(canvasSchema, {
  components: CANVAS_COMPONENTS,
  actions: {},
});

export type CanvasComponentName = keyof typeof CANVAS_COMPONENTS;

export const ALL_CANVAS_COMPONENTS = Object.keys(
  CANVAS_COMPONENTS,
) as CanvasComponentName[];

// Build a catalog limited to an allow-list of component names. A template uses
// this so the agent's system prompt only documents the components that template
// is allowed to emit. The renderer registry stays single-source (it maps ALL
// component names), so any saved canvas still renders — the allow-list only
// constrains what each template's agent is told it may produce.
export function canvasCatalogFor(names: readonly CanvasComponentName[]) {
  const components = Object.fromEntries(
    names.map((name) => [name, CANVAS_COMPONENTS[name]]),
  );
  return defineCatalog(canvasSchema, { components, actions: {} });
}
