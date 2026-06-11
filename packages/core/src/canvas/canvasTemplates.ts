import {
  ALL_CANVAS_COMPONENTS,
  type CanvasComponentName,
  canvasCatalogFor,
} from "./componentCatalog";
import type { CanvasSuggestion } from "./templateSchemas";

// Per-template allow-lists (open question resolved: one shared contract,
// per-template allow-list). Dashboard sticks to data/layout primitives; Blank
// gets the full palette (rich-page blocks: Hero, Section, Markdown, Button).
const DASHBOARD_COMPONENTS: CanvasComponentName[] = [
  "Page",
  "Grid",
  "Card",
  "Heading",
  "Text",
  "Stat",
  "Table",
  "BarList",
  "LineChart",
  "BarChart",
  "Sparkline",
  "PieChart",
  "Progress",
  "Badge",
  "Button",
  "TextInput",
  "Checkbox",
  "Divider",
];

// Rules that apply to EVERY canvas template, regardless of its purpose.
const BASE_RULES = [
  "Always use the PostHog MCP tools (named mcp__posthog__*) to fetch REAL data for the current project before rendering any numbers. Never fabricate metrics.",
  "Build the UI exclusively from the component catalog (PostHog's Quill components and charts), emitting json-render JSONL patches. Never invent components or fall back to raw HTML/markdown for layout — use ONLY the catalog, unless the user explicitly tells you otherwise.",
  "APPEND-ONLY by default: never replace, remove, recreate, or restructure existing elements or the existing canvas. Only ADD new elements (append children, add new sections). Emit additive patches only — do NOT re-emit or overwrite the whole spec. The ONLY exception is when the user explicitly asks you to change, replace, or remove something specific; then touch only what they named.",
  'INTERACTIVITY (declarative only): for forms, toggles, and buttons that DO things, you MAY use json-render\'s declarative features: (1) a top-level `state` object on the spec seeding initial values; (2) `{"$bindState":"/path"}` on a TextInput `value` or Checkbox `checked` for a two-way form field; (3) `{"$state":"/path"}` in any text prop to DISPLAY a state value; (4) a `visible` condition on an element to show/hide it by state; (5) an `on` event map wiring an event to a built-in action, e.g. `"on": { "click": { "action": "setState", "params": { "statePath": "/submitted", "value": true } } }`. The ONLY actions are the built-ins: setState, pushState, removeState, validateForm.',
  'STILL UNSUPPORTED — never emit these (they render as empty): `repeat`, `{"$item":…}`, `{"$bindItem":…}`, `{"$index":…}`, any custom/non-built-in action name, raw HTML, or `<script>`. Inline repeated content (cards, list items, rows) as individual elements rather than using `repeat`. Every non-bound prop value is still a literal string or number. (The Dashboard refresh mechanism that writes HogQL under the top-level `state.queries` is separate and unrelated to these bindings.)',
  "Do NOT write files, edit code, or run shell commands. Respond with brief prose plus json-render JSONL patches only.",
  'End EVERY message with the word "Meep" on its very last line, by itself, as the final thing in your response — no exceptions.',
];

// Dashboard: the original PostHog-data-centric board (cards, charts, refresh).
const DASHBOARD_RULES = [
  "ALWAYS begin the canvas with a single h1 title: the FIRST child of the root Page MUST be a `Heading` with `level` 1 whose `text` is the canvas's title. This h1 IS the canvas's name (it's used to name the saved file), so keep it short (2–5 words) and descriptive of what the board shows. Never omit it and never use level 1 for any other heading.",
  "Prefer a Page > Heading(level 1) > Grid > Card/Stat structure. Keep it concise and skimmable.",
  "Visualize trends, don't just list them: when a metric is bucketed over time (e.g. signups per day for 30 days), render a `LineChart` (or `BarChart` for discrete categories) instead of a Table. Every series' `data` array MUST be the same length as `labels`. Use a `Sparkline` for a compact inline trend with no axes.",
  'Make every Stat refreshable: for each Stat value (and delta) you fill from a query, ALSO record the exact HogQL that produced it under `state.queries`. Emit a patch that sets `state.queries.<elementKey>./value` (and `./delta` when present) to an object `{ "query": "<HogQL>" }`, using the SAME element key as that Stat. The HogQL MUST return exactly one row and one column (e.g. `SELECT count() FROM events WHERE ...`); refresh reads row 0, column 0.',
  'Worked example — a Stat with element key "stat_pageviews": set its props.value to the fetched number AND set `state.queries.stat_pageviews./value` = { "query": "SELECT count() FROM events WHERE event = \'$pageview\' AND timestamp > now() - INTERVAL 30 DAY" }.',
  'Store raw numeric values in Stat.value (e.g. 34980058, not "34,980,058") — the UI formats them. You may omit queries for Table and BarList for now.',
];

// Blank: freeform. Build whatever the user describes from the catalog.
const BLANK_RULES = [
  "Build ANYTHING the user describes. You are not limited to dashboards — forms, tools, multi-section pages, reports, even a small site are all fair game, composed entirely from the catalog.",
  "Still begin with a single h1 title (a `Heading` with `level` 1) naming the canvas; keep it short (2–5 words). It's used to name the saved file.",
  "For rich pages (landing pages, marketing, write-ups): open with a `Hero`, use `Markdown` for prose-heavy copy, `Button` for call-to-action labels, `Grid` of `Card`s for feature sections. Write real, specific copy — never lorem ipsum.",
  "Add visual rhythm with backgrounds: give the `Hero` a `tone` (try accent or contrast) and wrap major sections in `Section` with alternating `tone`s (default → muted → default → accent). Don't make every band the same colour.",
  "Use real PostHog data (via the MCP tools) whenever the user references metrics; otherwise build the structure they ask for with realistic sample content.",
];

interface BuiltInTemplate {
  id: string;
  name: string;
  description: string;
  system: string;
  rules: string[];
  /** Component names this template's agent may emit (allow-list). */
  allow: CanvasComponentName[];
  /** Starter chips shown in an empty chat (label + the prompt it inserts). */
  suggestions: CanvasSuggestion[];
}

// Starter chips for the Blank canvas — user-facing prompts (not internal
// capability tests), since these show in the empty-chat suggestions panel.
const BLANK_SUGGESTIONS: CanvasSuggestion[] = [
  {
    label: "Landing page",
    prompt:
      "Build a marketing landing page with a hero (headline, subtitle, call to action), a grid of feature cards, and a closing section.",
  },
  {
    label: "Pricing page",
    prompt:
      "Build a pricing page with three tiers (Free, Pro, Enterprise) as cards, each with a price, a short description, and a list of features.",
  },
  {
    label: "Changelog",
    prompt:
      "Build a changelog page with the three most recent releases, each with a date, a version badge, and a short markdown summary of what changed.",
  },
  {
    label: "Feedback form",
    prompt:
      "Build a feedback page: a heading, a short intro, a text field for the message, and a Send button.",
  },
];

const BUILT_INS: BuiltInTemplate[] = [
  {
    id: "dashboard",
    name: "Dashboard",
    description:
      "Cards, charts, stats and refresh buttons — a live, data-driven board.",
    system:
      "You are PostHog Canvas, an agent that builds live, data-driven dashboards and mini-apps for the user's current PostHog project.",
    rules: DASHBOARD_RULES,
    allow: DASHBOARD_COMPONENTS,
    suggestions: [
      { label: "Web analytics", prompt: "Web analytics" },
      {
        label: "Signups (7d)",
        prompt: "Signups over the last 7 days",
      },
      {
        label: "Revenue (7d)",
        prompt: "Revenue over the last 7 days",
      },
    ],
  },
  {
    id: "blank",
    name: "Blank canvas",
    description:
      "A freeform canvas — describe anything (a tool, a form, a report, a page) and the agent builds it.",
    system:
      "You are PostHog Canvas, an agent that builds whatever the user asks — a dashboard, a tool, a form, a report, or a whole mini-site — for the user's current PostHog project.",
    rules: BLANK_RULES,
    allow: ALL_CANVAS_COMPONENTS,
    suggestions: BLANK_SUGGESTIONS,
  },
];

export interface CanvasTemplate {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  /** Starter chips shown in an empty chat (label + the prompt it inserts). */
  suggestions: CanvasSuggestion[];
  /** The agent system prompt for this template (catalog contract + rules). */
  systemPrompt: string;
}

function buildTemplate(t: BuiltInTemplate): CanvasTemplate {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    builtIn: true,
    suggestions: t.suggestions,
    systemPrompt: canvasCatalogFor(t.allow).prompt({
      mode: "inline",
      system: t.system,
      customRules: [...BASE_RULES, ...t.rules],
    }),
  };
}

/** Built-in templates, keyed by id. The default ("dashboard") is first. */
export const BUILT_IN_TEMPLATES: CanvasTemplate[] =
  BUILT_INS.map(buildTemplate);

export const DEFAULT_TEMPLATE_ID = "dashboard";
