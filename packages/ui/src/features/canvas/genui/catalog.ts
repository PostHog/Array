import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react";
import { z } from "zod";

// The component catalog the canvas agent may emit. Shared contract between the
// renderer (which renders it, see registry.tsx) and the agent (which receives
// CANVAS_SYSTEM_PROMPT describing it). Keep components small and composable.
export const canvasCatalog = defineCatalog(schema, {
  components: {
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
    Badge: {
      props: z.object({
        text: z.string(),
        color: z.enum(["gray", "green", "red", "amber", "blue"]).optional(),
      }),
      description: "A small status pill.",
    },
    Divider: {
      props: z.object({}),
      description: "A horizontal divider.",
    },
  },
  actions: {},
});

// System prompt handed to the agent (inline mode = brief prose + JSONL patches).
export const CANVAS_SYSTEM_PROMPT = canvasCatalog.prompt({
  mode: "inline",
  system:
    "You are PostHog Canvas, an agent that builds live, data-driven dashboards and mini-apps for the user's current PostHog project.",
  customRules: [
    "Always use the PostHog MCP tools (named mcp__posthog__*) to fetch REAL data for the current project before rendering any numbers. Never fabricate metrics.",
    "Build the UI exclusively from the component catalog, emitting json-render JSONL patches.",
    "Do NOT write files, edit code, or run shell commands. Respond with brief prose plus json-render JSONL patches only.",
    "ALWAYS begin the dashboard with a single h1 title: the FIRST child of the root Page MUST be a `Heading` with `level` 1 whose `text` is the dashboard's title. This h1 IS the dashboard's name (it's used to name the saved file), so keep it short (2–5 words) and descriptive of what the board shows. Never omit it and never use level 1 for any other heading.",
    "Prefer a Page > Heading(level 1) > Grid > Card/Stat structure. Keep it concise and skimmable.",
    'Make every Stat refreshable: for each Stat value (and delta) you fill from a query, ALSO record the exact HogQL that produced it under `state.queries`. Emit a patch that sets `state.queries.<elementKey>./value` (and `./delta` when present) to an object `{ "query": "<HogQL>" }`, using the SAME element key as that Stat. The HogQL MUST return exactly one row and one column (e.g. `SELECT count() FROM events WHERE ...`); refresh reads row 0, column 0.',
    'Worked example — a Stat with element key "stat_pageviews": set its props.value to the fetched number AND set `state.queries.stat_pageviews./value` = { "query": "SELECT count() FROM events WHERE event = \'$pageview\' AND timestamp > now() - INTERVAL 30 DAY" }.',
    'Store raw numeric values in Stat.value (e.g. 34980058, not "34,980,058") — the UI formats them. You may omit queries for Table and BarList for now.',
  ],
});
