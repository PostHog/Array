// Compact, prompt-ready descriptions of what each notebook component tag's
// props support. Fed to the model alongside the node's current props so it
// can summarize accurately and produce valid replacement props. Deliberately
// terse — the full vendored OpenAPI schema is megabytes; this is the working
// subset the notebook embeds actually render.

const QUERY_KNOWLEDGE = `Props shape: { "query": <query node>, "title"?: string }.
The query node is a PostHog insight query. Supported kinds:

- Wrappers: { "kind": "InsightVizNode", "source": <insight query> } renders charts;
  { "kind": "DataTableNode", "source": <EventsQuery|ActorsQuery|HogQLQuery>, "columns"?: string[] } renders tables.
- TrendsQuery: { "kind": "TrendsQuery", "series": [<EventsNode|ActionsNode>...],
  "interval"?: "hour"|"day"|"week"|"month",
  "dateRange"?: { "date_from": string, "date_to"?: string|null },
  "trendsFilter"?: { "display"?: "ActionsLineGraph"|"ActionsLineGraphCumulative"|"ActionsAreaGraph"|"ActionsBar"|"ActionsBarValue"|"ActionsPie"|"ActionsTable"|"BoldNumber"|"WorldMap" },
  "breakdownFilter"?: { "breakdown": string, "breakdown_type": "event"|"person"|"group" } or { "breakdowns": [{ "property": string, "type": "event"|"person" }] },
  "properties"?: [<property filters>] }.
- EventsNode series entry: { "kind": "EventsNode", "event": string, "name"?: string, "custom_name"?: string,
  "math"?: "total"|"dau"|"weekly_active"|"monthly_active"|"unique_session"|"sum"|"avg"|"min"|"max"|"median",
  "math_property"?: string, "properties"?: [...] }. ActionsNode: { "kind": "ActionsNode", "id": number }.
- FunnelsQuery: { "kind": "FunnelsQuery", "series": [<EventsNode>... in step order], "dateRange"?, "funnelsFilter"?: { "funnelVizType"?: "steps"|"time_to_convert"|"trends", "funnelWindowInterval"?: number, "funnelWindowIntervalUnit"?: "minute"|"hour"|"day"|"week"|"month" } }.
- RetentionQuery: { "kind": "RetentionQuery", "retentionFilter": { "period": "Day"|"Week"|"Month", "totalIntervals": number, "targetEntity": { "id": string, "name": string, "type": "events" }, "returningEntity": <same shape> }, "dateRange"? }.
- PathsQuery: { "kind": "PathsQuery", "pathsFilter": { "includeEventTypes": ["$pageview"|"$screen"|"custom_event"...] }, "dateRange"? }.
- StickinessQuery / LifecycleQuery: { "kind": ..., "series": [<EventsNode>...], "dateRange"? } (+ "stickinessFilter"/"lifecycleFilter").
- HogQLQuery: { "kind": "HogQLQuery", "query": "<SQL string, ClickHouse-flavoured HogQL>" }.
- EventsQuery (raw events table, use inside DataTableNode): { "kind": "EventsQuery", "select": ["*","event","person","timestamp"...], "event"?: string, "after"?: "-24h", "limit"?: number, "properties"?: [...] }.
- SavedInsightNode: { "kind": "SavedInsightNode", "shortId": string } references an insight saved in PostHog.

Date range strings: relative like "-24h", "-7d", "-30d", "-90d", "-1m", or "dStart" (today), "mStart" (this month), "yStart", "all", or absolute "YYYY-MM-DD".
Common events: "$pageview", "$pageleave", "$autocapture", "$identify". Common breakdown properties: "$browser", "$os", "$geoip_country_code", "$current_url", "$device_type".
Keep the wrapper kind (InsightVizNode/DataTableNode) unless the change requires switching it.`;

const NOTEBOOK_NODE_AI_KNOWLEDGE: Record<string, string> = {
  Query: QUERY_KNOWLEDGE,
  FeatureFlag:
    'Props shape: { "id": number | string, "title"?: string }. `id` is the feature flag\'s numeric id or its string key. The node renders the live flag (name, status, rollout) fetched from PostHog. Never invent an id or key.',
  Experiment:
    'Props shape: { "id": number, "title"?: string }. `id` is the experiment\'s numeric id. The node renders the live experiment. Never invent an id.',
  Survey:
    'Props shape: { "id": string, "title"?: string }. `id` is the survey\'s UUID. The node renders the live survey (questions, status). Never invent an id.',
  EarlyAccessFeature:
    'Props shape: { "id": string, "title"?: string }. `id` is the early access feature\'s UUID. Never invent an id.',
  Cohort:
    'Props shape: { "id": number, "title"?: string }. `id` is the cohort\'s numeric id. Never invent an id.',
  Person:
    'Props shape: { "distinctId": string, "title"?: string }. `distinctId` identifies the person. Never invent a distinct id.',
  Group:
    'Props shape: { "groupKey": string, "groupTypeIndex": number, "title"?: string }. Never invent a group key.',
  Recording:
    'Props shape: { "sessionRecordingId": string, "title"?: string }. Never invent a recording id.',
};

const GENERIC_KNOWLEDGE =
  'Props are an arbitrary JSON object rendered by the notebook. A "title" string prop, when present, is shown as the block title.';

export function getNotebookNodeKnowledge(tagName: string): string {
  return NOTEBOOK_NODE_AI_KNOWLEDGE[tagName] ?? GENERIC_KNOWLEDGE;
}

export function buildNotebookNodeSummarySystemPrompt(): string {
  return [
    "You summarize PostHog notebook blocks for a block-editing side panel.",
    "Reply with ONLY the summary: one plain-text sentence (two at most), under 220 characters, no markdown, no quotes, no preamble.",
    'Describe what the block shows in product terms a PostHog user recognizes (e.g. "Trends line chart: pageviews vs. signups, last 30 days, broken down by browser").',
    "Mention chart type, series/steps, date range, breakdowns, filters, or entity name/status when present. Do not mention JSON, props, or internal field names.",
  ].join("\n");
}

export function buildNotebookNodeSummaryUserPrompt(input: {
  tagName: string;
  propsJson: string;
  knowledge: string;
  liveEntityJson?: string | null;
}): string {
  const sections = [
    `Notebook block type: <${input.tagName} />`,
    `What this block type supports:\n${input.knowledge}`,
    `Current props JSON:\n${input.propsJson}`,
  ];
  if (input.liveEntityJson) {
    sections.push(
      `Live object fetched from PostHog (for context):\n${input.liveEntityJson}`,
    );
  }
  sections.push("Summarize this block now.");
  return sections.join("\n\n");
}

export function buildNotebookNodeChangeSystemPrompt(): string {
  return [
    "You edit PostHog notebook blocks. Given a block's current props JSON and a user change request, produce the FULL replacement props and a fresh summary.",
    'Reply with ONLY one JSON object, no markdown fences, no commentary: {"props": { ...complete replacement props... }, "summary": "..."}.',
    "Rules:",
    "- `props` must be the complete new props object (not a diff). Preserve every existing prop the request does not ask to change.",
    "- Only use fields the block type supports. Never invent entity ids, keys, or recording ids.",
    "- `summary` is one plain-text sentence (two at most, under 220 characters) describing the block AFTER the change, same style as the current summary.",
    "- If the request is impossible for this block type, return the original props unchanged and explain why in the summary, prefixed with 'Unchanged:'.",
  ].join("\n");
}

export function buildNotebookNodeChangeUserPrompt(input: {
  tagName: string;
  propsJson: string;
  knowledge: string;
  request: string;
  currentSummary?: string | null;
  liveEntityJson?: string | null;
  retryContext?: { previousResponse: string; problem: string } | null;
}): string {
  const sections = [
    `Notebook block type: <${input.tagName} />`,
    `What this block type supports:\n${input.knowledge}`,
    `Current props JSON:\n${input.propsJson}`,
  ];
  if (input.currentSummary) {
    sections.push(`Current summary: ${input.currentSummary}`);
  }
  if (input.liveEntityJson) {
    sections.push(
      `Live object fetched from PostHog (for context):\n${input.liveEntityJson}`,
    );
  }
  sections.push(`User change request: ${input.request}`);
  if (input.retryContext) {
    sections.push(
      [
        "Your previous reply could not be applied.",
        `Previous reply:\n${input.retryContext.previousResponse}`,
        `Problem: ${input.retryContext.problem}`,
        'Reply again with ONLY the corrected {"props": ..., "summary": ...} JSON object.',
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
}
