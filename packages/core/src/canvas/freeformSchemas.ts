import { z } from "zod";

// The template id for freeform-React canvases. Stored on a canvas's meta the
// same way "dashboard"/"web-analytics"/"blank" are, so the render path can tell
// a freeform canvas (code in an iframe) from a json-render one (spec tree).
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
  // The user prompt that produced this version (absent for the seed/empty one).
  prompt: z.string().optional(),
  // Epoch ms the version was created.
  createdAt: z.number(),
});
export type FreeformVersion = z.infer<typeof freeformVersionSchema>;

// The freeform-specific payload that rides in a canvas's file-system `meta`
// blob, alongside the json-render fields. Absent on json-render canvases.
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
});
export type FreeformCanvas = z.infer<typeof freeformCanvasSchema>;

// ---------------------------------------------------------------------------
// Code-stream events: the agent writes a single React file (not json-render
// patches), so we stream prose + full-file code snapshots instead of specs.
// Mirrors genSchemas' CanvasStreamEvent shape for the json-render agent.
// ---------------------------------------------------------------------------
export const freeformStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("started") }),
  z.object({ type: z.literal("prose"), text: z.string() }),
  // A full-file source snapshot. The agent rewrites the whole file each turn, so
  // each snapshot replaces (not appends to) the previous code.
  z.object({ type: z.literal("code"), code: z.string() }),
  z.object({
    type: z.literal("tool"),
    toolName: z.string(),
    status: z.string(),
  }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type FreeformStreamEvent = z.infer<typeof freeformStreamEventSchema>;

// Input for a freeform generation turn. Mirrors canvasGenerateInput but seeds
// the agent with the current CODE (not a spec) so it rewrites the existing file
// instead of starting blank.
export const freeformGenerateInput = z.object({
  threadId: z.string().min(1),
  prompt: z.string().min(1),
  // The canvas's current source, sent each turn so the session is anchored to
  // what's on screen even after a renderer reload. Empty/absent = new canvas.
  currentCode: z.string().nullish(),
  model: z.string().optional(),
});
export type FreeformGenerateInput = z.infer<typeof freeformGenerateInput>;

export const freeformThreadInput = z.object({ threadId: z.string().min(1) });
export type FreeformThreadInput = z.infer<typeof freeformThreadInput>;

export const FreeformGenEvent = { Event: "freeform-event" } as const;

export interface FreeformGenEventPayload {
  threadId: string;
  event: FreeformStreamEvent;
}

export interface FreeformGenEvents {
  [FreeformGenEvent.Event]: FreeformGenEventPayload;
}

// ---------------------------------------------------------------------------
// Canvas data avenue: the host-side query the postMessage `ph.query` shim calls.
// Routed through PostHog's cached query runner (the same avenue insights use, so
// caching + cold-boot are handled), never a bare uncached /query (the token is
// injected host-side; the iframe only sees this shape). Edit mode runs inline
// HogQL; view/published mode (Phase 3) will reject inline and require a named,
// server-stored insight via `run`.
// ---------------------------------------------------------------------------
export const canvasDataQueryInput = z.object({
  hogql: z.string().min(1),
  // Reserved for bound parameters (Phase 3 named queries). Edit mode ignores it.
  params: z.record(z.string(), z.unknown()).optional(),
});
export type CanvasDataQueryInput = z.infer<typeof canvasDataQueryInput>;

export const canvasDataResultSchema = z.object({
  columns: z.array(z.string()),
  // Each row is an array of cell values, aligned to `columns`.
  results: z.array(z.array(z.unknown())),
});
export type CanvasDataResult = z.infer<typeof canvasDataResultSchema>;

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
]);
export type HostToCanvasMessage = z.infer<typeof hostToCanvasMessageSchema>;

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
  // The iframe reporting its content height so the host can size it without
  // an inner scrollbar.
  z.object({
    channel: z.literal(CANVAS_CHANNEL),
    type: z.literal("resize"),
    height: z.number(),
  }),
]);
export type CanvasToHostMessage = z.infer<typeof canvasToHostMessageSchema>;
