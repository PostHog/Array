import { isSafePostHogUrl } from "@posthog/shared";
import { z } from "zod";

// The template id for freeform-React canvases. Stored on a canvas's meta so the
// generation path can resolve the right system prompt.
export const FREEFORM_TEMPLATE_ID = "freeform";

// A single point in a freeform canvas's edit history. Every agent turn appends
// one full-file snapshot (Q7: full-file rewrite); the user can revert to any of
// them and the `currentVersionId` pointer is what publishes. We keep whole-file
// snapshots rather than diffs because canvases are small and a snapshot can
// never fail to reconstruct.
export const freeformVersionSchema = z.object({
  id: z.string(),
  // The complete single-file React source for this version.
  code: z.string(),
  // The author-written context (markdown) passed to the agent, as it stood for
  // this version. Snapshotted so reverting restores the context too. Absent on
  // versions saved before the Context tab existed.
  context: z.string().optional(),
  // The user prompt that produced this version (absent for the seed/empty one,
  // and for a version created by a context-only edit).
  prompt: z.string().optional(),
  // Epoch ms the version was created.
  createdAt: z.number(),
});
export type FreeformVersion = z.infer<typeof freeformVersionSchema>;

// The freeform-specific payload that rides in a canvas's file-system `meta` blob.
export const freeformCanvasSchema = z.object({
  // The currently-rendered source (mirrors the version pointed to by
  // currentVersionId; duplicated so the renderer needs only this field).
  code: z.string(),
  // Full, ordered edit history (oldest first). Always contains >= 1 entry once
  // the agent has produced anything.
  versions: z.array(freeformVersionSchema).default([]),
  // Which version is live. Undo/redo moves this pointer; a new agent turn
  // truncates any "redo" tail (Q8: linear-discard) and appends.
  currentVersionId: z.string().optional(),
  // The live author-written context (markdown), mirrors the version pointed to by
  // currentVersionId. Prepended to every agent turn so the build is anchored to it.
  context: z.string().default(""),
});
export type FreeformCanvas = z.infer<typeof freeformCanvasSchema>;

// ---------------------------------------------------------------------------
// Canvas data avenue: the host-side query the postMessage `ph.query` shim calls.
// Routed through PostHog's cached query runner (the same avenue insights use, so
// caching + cold-boot are handled), never a bare uncached /query (the token is
// injected host-side; the iframe only sees this shape).
//
// Two shapes (the agent picks per metric; see the canvas templates skill):
//   • `query` — a TYPED query node (`{ kind: "TrendsQuery" | "FunnelsQuery" |
//     "HogQLQuery" | … }`). PREFERRED: the product's own query runners compute it,
//     so the numbers match the PostHog UI (sessionization, unique users, bounce
//     rate, breakdowns, math) and the typed `dateRange` handles windows correctly.
//   • `hogql` — an inline HogQL string (wrapped server-side as a HogQLQuery).
//     Escape hatch for shapes a typed node can't express; the agent owns the SQL.
// Exactly one must be present. Edit mode allows both; view/published mode (Phase 3)
// rejects inline and requires a named, server-stored insight via `run`.
// ---------------------------------------------------------------------------
export const canvasDataQueryInput = z
  .object({
    // A typed query node passed straight to the query runner. Opaque here (the
    // node schemas are large + product-owned); validated by the API on execution.
    query: z.record(z.string(), z.unknown()).optional(),
    // Inline HogQL string (the escape hatch). Server wraps it as a HogQLQuery.
    hogql: z.string().min(1).optional(),
    // Reserved for bound parameters (Phase 3 named queries). Edit mode ignores it.
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => v.query != null || v.hogql != null, {
    message: "ph.query requires a query node or a HogQL string",
  });
export type CanvasDataQueryInput = z.infer<typeof canvasDataQueryInput>;

export const canvasDataResultSchema = z.object({
  columns: z.array(z.string()),
  // The result rows. SHAPE DEPENDS ON THE QUERY KIND (true for both `ph.query`
  // and `ph.loadInsight`):
  //   • HogQLQuery / SQL insight → an array of ROWS, each row an array of cell
  //     values aligned to `columns` (e.g. `[[123], [456]]`).
  //   • Typed nodes / trends-style insight → an array of SERIES OBJECTS as PostHog
  //     returns them — `{ data: number[], labels: string[], days: string[],
  //     count, aggregated_value, compare_label, … }`. NOT rows-of-cells; passed
  //     through untouched so the canvas reads the native trends shape.
  // Hence `unknown` per element rather than `unknown[]`.
  results: z.array(z.unknown()),
});
export type CanvasDataResult = z.infer<typeof canvasDataResultSchema>;

// ---------------------------------------------------------------------------
// Load-insight avenue: the host-side fetch behind the `ph.loadInsight` shim. The
// canvas references a SAVED, validated PostHog insight by `short_id` and the host
// returns its STORED result from the insights endpoint (not a fresh `/query/`
// run). This is the preferred data path — every metric is a proven saved insight.
// `dateRange` (the canvas date picker's window) re-scopes the insight for this
// request via `filters_override`. The result is the same `{ columns, results }`
// shape as `ph.query`.
// ---------------------------------------------------------------------------
export const canvasLoadInsightInput = z.object({
  shortId: z.string().min(1),
  dateRange: z
    .object({ date_from: z.string().nullish(), date_to: z.string().nullish() })
    .optional(),
});
export type CanvasLoadInsightInput = z.infer<typeof canvasLoadInsightInput>;

// Capture (write) avenue behind the `ph.capture` shim. The host sends the event
// to the project using its PUBLIC project key (phc_…, safe to be client-side) —
// the private read token still never enters the iframe. `distinctId` is who the
// event is attributed to; defaults host-side when omitted.
export const canvasCaptureInput = z.object({
  event: z.string().min(1),
  distinctId: z.string().min(1).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});
export type CanvasCaptureInput = z.infer<typeof canvasCaptureInput>;

export const canvasCaptureResultSchema = z.object({ ok: z.boolean() });
export type CanvasCaptureResult = z.infer<typeof canvasCaptureResultSchema>;

// What the host hands the UI to bootstrap in-iframe analytics/replay. The
// public capture key + the signed-in user's distinct_id; the private token is
// never included. The UI forwards this into the iframe `init` frame.
export const canvasCaptureConfigSchema = z.object({
  apiHost: z.string(),
  publicKey: z.string(),
  distinctId: z.string().optional(),
});
export type CanvasCaptureConfig = z.infer<typeof canvasCaptureConfigSchema>;

// ---------------------------------------------------------------------------
// Live events avenue: a streaming counterpart to the request/response data
// requests. A freeform canvas CANNOT hold the project's `live_events_token`
// (a project-scoped credential, deliberately never shipped into the null-origin
// iframe — same rule as the read token). Instead the canvas sends a subscribe
// request; the HOST opens the SSE connection to the live-events service
// (`live.{region}.posthog.com/events`) with the brokered JWT and fans each
// event into the iframe as a `live-event` frame. The same brokered avenue serves
// `live-stats` (the project's realtime `users_on_product` / `active_recordings`
// counters from `/stats`) on demand. Only the region's public live HOST and the
// (non-credential) subscription params cross into the iframe.
// ---------------------------------------------------------------------------

// The property-filter operators the live-events service supports. THIS LIST IS
// AUTHORITATIVE over the frontend's richer `PropertyOperator` set (the
// livestream service only compiles a fixed operator allowlist) — mirroring
// `LIVE_EVENTS_SUPPORTED_OPERATORS` in the app's Activity → Live events logic,
// and the canvas prompt tells the agent not to invent others. Values are the
// operator ids as the service expects them.
export const LIVE_EVENTS_SUPPORTED_OPERATORS = [
  "exact",
  "is_not",
  "icontains",
  "not_icontains",
  "regex",
  "not_regex",
  "gt",
  "gte",
  "lt",
  "lte",
  "is_set",
  "is_not_set",
] as const;
export type LiveEventsOperator =
  (typeof LIVE_EVENTS_SUPPORTED_OPERATORS)[number];

// A single property filter on the live stream: an event-property `key`
// matched by `operator` against `value` (omit `value` for `is_set`/`is_not_set`).
// `value` may be a scalar or an array of scalars (array => OR, same as the app).
export const liveEventPropertyFilterSchema = z.object({
  key: z.string().min(1),
  operator: z.enum(LIVE_EVENTS_SUPPORTED_OPERATORS),
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.union([z.string(), z.number(), z.boolean()])),
    ])
    .optional(),
});
export type LiveEventPropertyFilter = z.infer<
  typeof liveEventPropertyFilterSchema
>;

// What the canvas subscribes to. `eventType` filters to a single event name
// (omit = all events); `properties` are AND-ed rich filters (same allowlist as
// the app's live feed); `columns` is a properties whitelist (empty/absent = all);
// `distinctId` restricts to one actor. Mirrors the app's live feed params.
export const canvasLiveEventsSubscribeInput = z.object({
  eventType: z.string().min(1).nullish(),
  distinctId: z.string().min(1).nullish(),
  columns: z.array(z.string()).nullish(),
  properties: z.array(liveEventPropertyFilterSchema).nullish(),
});
export type CanvasLiveEventsSubscribeInput = z.infer<
  typeof canvasLiveEventsSubscribeInput
>;

// A single live event delivered to the canvas. Shape matches the livestream
// service's `ResponsePostHogEvent`; the canvas ALSO derives a client-side
// "users online" sliding-window count from `distinct_id`s on these events.
export const liveEventSchema = z.object({
  id: z.string().optional(),
  distinct_id: z.string(),
  event: z.string(),
  timestamp: z.string(),
  properties: z.record(z.string(), z.unknown()).optional(),
});
export type LiveEvent = z.infer<typeof liveEventSchema>;

// The realtime counters the project's `/stats` endpoint returns — the same
// "N users currently online" pill and active-recordings count the app shows.
export const canvasLiveStatsSchema = z.object({
  users_on_product: z.number().optional(),
  active_recordings: z.number().optional(),
});
export type CanvasLiveStats = z.infer<typeof canvasLiveStatsSchema>;

// The brokered connection details the host renderer uses to open the SSE
// stream. `eventsUrl`/`statsUrl` are the live-events service endpoints;
// `token` is the project-scoped live-events JWT (minted server-side by
// Django as `team.live_events_token`). This object crosses renderer<->main
// ONLY — it must never be forwarded into the sandboxed iframe.
export const canvasLiveConnectionConfigSchema = z.object({
  eventsUrl: z.string(),
  statsUrl: z.string(),
  token: z.string(),
});
export type CanvasLiveConnectionConfig = z.infer<
  typeof canvasLiveConnectionConfigSchema
>;

// ---------------------------------------------------------------------------
// Host <-> iframe postMessage protocol (Q10/Q11). The canvas runs in a
// null-origin sandboxed iframe, so it CANNOT share JS objects with the host —
// every interaction is a structured-clone message. The real PostHog token never
// crosses this boundary: the iframe sends a data-request; the host runs the
// authenticated call and returns only the result.
// ---------------------------------------------------------------------------

// Stamped on every frame so a page hosting multiple canvas iframes (or other
// postMessage traffic) can route unambiguously.
const CANVAS_CHANNEL = "posthog-canvas" as const;
export const CANVAS_MESSAGE_CHANNEL = CANVAS_CHANNEL;

// Analytics bootstrap config handed to the iframe so posthog-js can run INSIDE
// it (the only way session replay records the app's DOM). Only the PUBLIC
// capture key crosses — never the private read token. `distinctId` seeds
// attribution (the signed-in user in edit; omitted for anonymous shared
// viewers, who get an auto-generated id). `persist` is false on a null-origin
// sandbox (no storage) → memory session; true on the usercontent origin.
export const canvasAnalyticsConfigSchema = z.object({
  apiHost: z.string(),
  publicKey: z.string(),
  distinctId: z.string().optional(),
  persist: z.boolean(),
});
export type CanvasAnalyticsConfig = z.infer<typeof canvasAnalyticsConfigSchema>;

// The light/dark appearance the host wants the canvas to render in. Mirrors the
// host's resolved theme (system preference already collapsed to light/dark).
// The iframe toggles a `.dark` class on its document root from this — the same
// mechanism the main app uses — so Quill's CSS tokens and `dark:` utilities flip.
export const canvasThemeSchema = z.enum(["light", "dark"]);
export type CanvasTheme = z.infer<typeof canvasThemeSchema>;

// host -> iframe
export const hostToCanvasMessageSchema = z.discriminatedUnion("type", [
  // First frame: hand the iframe its source + the run mode. The iframe does not
  // fetch its own code; the host injects it so the host controls what runs.
  z.object({
    channel: z.literal(CANVAS_CHANNEL),
    type: z.literal("init"),
    code: z.string(),
    // "edit" = author in-app (full-API shim, CDN packages, open egress).
    // "view" = published/shared (frozen named queries, closed egress).
    mode: z.enum(["edit", "view"]),
    // Present when analytics/replay should run in the iframe. Absent = no capture.
    analytics: canvasAnalyticsConfigSchema.optional(),
    // The appearance to render in. Carried on `init` so the first render is
    // already correct; live theme changes use the `set-theme` frame below
    // (which re-themes without remounting). Absent = light.
    theme: canvasThemeSchema.optional(),
  }),
  // Live theme change: re-apply light/dark WITHOUT remounting the app. Sent on
  // its own (not folded into `init`) so toggling the host theme — or an OS
  // dark/light flip under the "system" preference — doesn't reset canvas state.
  z.object({
    channel: z.literal(CANVAS_CHANNEL),
    type: z.literal("set-theme"),
    theme: canvasThemeSchema,
  }),
  // Reply to a data-request, correlated by `id`.
  z.object({
    channel: z.literal(CANVAS_CHANNEL),
    type: z.literal("data-response"),
    id: z.string(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  // A single live event from the live-events SSE stream, fanned into the iframe.
  // `subId` ties it to the canvas's subscribe request so a canvas can run
  // several independent streams (e.g. one feed per event type).
  z.object({
    channel: z.literal(CANVAS_CHANNEL),
    type: z.literal("live-event"),
    subId: z.string(),
    event: liveEventSchema,
  }),
  // A terminal live-stream state change (auth failure, network close, or a
  // deliberate `live-unsubscribe` ack). `status` is "closed" (no more events,
  // do not retry) or "error" (the stream dropped; the canvas MAY resubscribe).
  z.object({
    channel: z.literal(CANVAS_CHANNEL),
    type: z.literal("live-stream-status"),
    subId: z.string(),
    status: z.enum(["closed", "error"]),
    message: z.string().optional(),
  }),
]);
export type HostToCanvasMessage = z.infer<typeof hostToCanvasMessageSchema>;

// The ONLY navigations a canvas may request of the host. The canvas runs
// untrusted code in a null-origin iframe, so this nested union IS the security
// allowlist: there is no free-form path/route field, only these four targets.
// `channelId` is intentionally absent — the host supplies it from the loaded
// record so the iframe can never pick the channel, only which task/dashboard.
export const canvasNavIntentSchema = z.discriminatedUnion("target", [
  z.object({ target: z.literal("task"), taskId: z.string().min(1) }),
  z.object({ target: z.literal("new-task") }),
  z.object({ target: z.literal("canvas"), dashboardId: z.string().min(1) }),
  z.object({ target: z.literal("new-canvas") }),
]);
export type CanvasNavIntent = z.infer<typeof canvasNavIntentSchema>;

// iframe -> host
export const canvasToHostMessageSchema = z.discriminatedUnion("type", [
  // Iframe runtime is mounted and ready to receive `init`.
  z.object({
    channel: z.literal(CANVAS_CHANNEL),
    type: z.literal("ready"),
  }),
  // A data call from canvas code. `method` is the shim method (e.g. "run" for a
  // named query, "query" for inline HogQL in edit mode). The host validates +
  // executes; nothing here carries credentials.
  z.object({
    channel: z.literal(CANVAS_CHANNEL),
    type: z.literal("data-request"),
    id: z.string(),
    method: z.string(),
    payload: z.unknown(),
  }),
  // A runtime/compile error from inside the iframe, surfaced so the host can
  // show a non-blocking notice and feed it back to the agent for self-repair
  // (Q7 error-recovery loop).
  z.object({
    channel: z.literal(CANVAS_CHANNEL),
    type: z.literal("error"),
    message: z.string(),
    stack: z.string().optional(),
  }),
  // The canvas rendered successfully (clears any prior error state).
  z.object({
    channel: z.literal(CANVAS_CHANNEL),
    type: z.literal("rendered"),
  }),
  // A request to navigate the host app. Fire-and-forget (no id/response). The
  // `nav` payload is the allowlist above — the host drops anything that doesn't
  // parse, so the iframe can only reach the four sanctioned destinations.
  z.object({
    channel: z.literal(CANVAS_CHANNEL),
    type: z.literal("navigate"),
    nav: canvasNavIntentSchema,
  }),
  // Open a URL outside the sandbox. The PostHog-only https allowlist is part
  // of the schema, so no consumer can forward an unvalidated URL.
  z.object({
    channel: z.literal(CANVAS_CHANNEL),
    type: z.literal("open-external"),
    url: z.string().refine(isSafePostHogUrl),
  }),
  // Subscribe to the live-events stream. The host mints/brokers the scoped JWT
  // (never sent to the iframe) and streams matching events back as `live-event`
  // frames for this `subId` until the canvas unsubscribes or the stream ends.
  z.object({
    channel: z.literal(CANVAS_CHANNEL),
    type: z.literal("live-subscribe"),
    subId: z.string(),
    params: canvasLiveEventsSubscribeInput,
  }),
  // Cancel a live-events subscription the canvas no longer needs (component
  // unmount, filter change). The host closes the upstream SSE connection.
  z.object({
    channel: z.literal(CANVAS_CHANNEL),
    type: z.literal("live-unsubscribe"),
    subId: z.string(),
  }),
  // NOTE: a live `liveStats` poll also rides the generic `data-request` frame
  // above (method: "liveStats") — it's a one-shot read, not a stream.
]);
export type CanvasToHostMessage = z.infer<typeof canvasToHostMessageSchema>;
