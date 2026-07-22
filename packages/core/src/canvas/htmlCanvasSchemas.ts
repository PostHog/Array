import { z } from "zod";

// The template id for HTML-document canvases. Stored on a canvas's meta like
// the freeform id, so the generation path can resolve the right system prompt
// and the renderer can pick the HTML frame instead of the React sandbox.
export const HTML_TEMPLATE_ID = "html";

// Whether a canvas templateId renders as a raw HTML document (vs freeform React).
export function isHtmlTemplate(id: string | undefined): boolean {
  return id === HTML_TEMPLATE_ID;
}

// ---------------------------------------------------------------------------
// Host <-> annotation-shim postMessage protocol. An HTML canvas renders in a
// null-origin sandboxed iframe (like freeform), with a small annotation shim
// script injected into the artifact document. The shim owns everything that
// must happen inside the iframe's DOM — text selection, element picking,
// painting highlights/pins — and the host owns comment state and persistence.
// Structured-clone messages, Zod-validated on both ends, are the only channel.
//
// Deliberately absent vs the freeform protocol: no `init`/`code` frame (the
// artifact IS the srcDoc), no `data-request` (no `ph` shim — the document is
// static), and no `set-theme` (the artifact owns its own styling).
// ---------------------------------------------------------------------------

// Stamped on every frame so pages hosting multiple iframes (or other
// postMessage traffic) can route unambiguously. Distinct from the freeform
// canvas stamp so the two protocols can never cross wires.
const HTML_CANVAS_CHANNEL = "posthog-html-canvas" as const;
export const HTML_CANVAS_MESSAGE_CHANNEL = HTML_CANVAS_CHANNEL;

// A rectangle in the iframe's viewport coordinates. The host iframe fills its
// wrapper, so these double as wrapper-relative coordinates for positioning
// composers/popovers without any offset math.
export const htmlCanvasRectSchema = z.object({
  top: z.number(),
  left: z.number(),
  width: z.number(),
  height: z.number(),
});
export type HtmlCanvasRect = z.infer<typeof htmlCanvasRectSchema>;

// ---------------------------------------------------------------------------
// Comment anchors — how a comment points back into the document. These are
// BOTH the wire shape (shim <-> host) and the stored contract (they ride in
// the PostHog comment's `item_context` JSON, see canvasCommentsSchemas.ts).
// ---------------------------------------------------------------------------

// A W3C-style text-quote selector: the selected text plus ~32 normalized chars
// of context on each side to disambiguate repeated quotes. Resolved by
// searching the document's normalized text — robust to the quote MOVING in the
// document, orphaned when the text itself is reworded.
export const textQuoteAnchorSchema = z.object({
  type: z.literal("text"),
  quote: z.string().min(1),
  prefix: z.string().default(""),
  suffix: z.string().default(""),
});
export type TextQuoteAnchor = z.infer<typeof textQuoteAnchorSchema>;

// An element anchor: a CSS selector path ("#id" shortcut when the element has
// a unique id, else a tag:nth-of-type path) plus a human-readable label so the
// panel can describe the target even when the selector no longer resolves.
export const elementAnchorSchema = z.object({
  type: z.literal("element"),
  selector: z.string().min(1),
  label: z.string().default(""),
});
export type ElementAnchor = z.infer<typeof elementAnchorSchema>;

// A page-level comment — attached to the document as a whole, nothing to paint.
export const pageAnchorSchema = z.object({ type: z.literal("page") });

export const commentAnchorSchema = z.discriminatedUnion("type", [
  textQuoteAnchorSchema,
  elementAnchorSchema,
  pageAnchorSchema,
]);
export type CommentAnchor = z.infer<typeof commentAnchorSchema>;

// One annotation the host wants painted: a root comment's id, its 1-based pin
// number (the panel shows the same number), and where it anchors.
export const htmlCanvasAnnotationSchema = z.object({
  id: z.string(),
  index: z.number().int(),
  anchor: commentAnchorSchema,
});
export type HtmlCanvasAnnotation = z.infer<typeof htmlCanvasAnnotationSchema>;

// host -> shim
export const hostToHtmlCanvasMessageSchema = z.discriminatedUnion("type", [
  // Idempotent full replace of everything to paint (highlights + numbered
  // pins). Sent after `ready` and again whenever the comment set changes.
  z.object({
    channel: z.literal(HTML_CANVAS_CHANNEL),
    type: z.literal("set-annotations"),
    annotations: z.array(htmlCanvasAnnotationSchema),
  }),
  // Toggle element-pick mode (hover outline + click-to-anchor). Text selection
  // is always live and needs no mode.
  z.object({
    channel: z.literal(HTML_CANVAS_CHANNEL),
    type: z.literal("set-pick-mode"),
    active: z.boolean(),
  }),
  // Emphasize one annotation (e.g. the panel row was clicked). `scroll` also
  // scrolls its anchor into view. `id: null` clears the emphasis.
  z.object({
    channel: z.literal(HTML_CANVAS_CHANNEL),
    type: z.literal("set-active"),
    id: z.string().nullable(),
    scroll: z.boolean(),
  }),
  // Drop the pending draft highlight (the composer was submitted or dismissed).
  z.object({
    channel: z.literal(HTML_CANVAS_CHANNEL),
    type: z.literal("clear-draft"),
  }),
]);
export type HostToHtmlCanvasMessage = z.infer<
  typeof hostToHtmlCanvasMessageSchema
>;

// shim -> host
export const htmlCanvasToHostMessageSchema = z.discriminatedUnion("type", [
  // Shim installed and the DOM above it is parsed; the host may now push
  // annotations and mode state.
  z.object({
    channel: z.literal(HTML_CANVAS_CHANNEL),
    type: z.literal("ready"),
  }),
  // A non-empty text selection settled (debounced). The host shows the
  // floating comment affordance at `rect`.
  z.object({
    channel: z.literal(HTML_CANVAS_CHANNEL),
    type: z.literal("selection"),
    anchor: textQuoteAnchorSchema,
    rect: htmlCanvasRectSchema,
  }),
  // The selection collapsed/cleared without becoming a draft.
  z.object({
    channel: z.literal(HTML_CANVAS_CHANNEL),
    type: z.literal("selection-cleared"),
  }),
  // Pick mode: the user clicked an element. The shim freezes a draft outline
  // on it; the host opens the composer and later confirms exit via
  // `set-pick-mode { active: false }`.
  z.object({
    channel: z.literal(HTML_CANVAS_CHANNEL),
    type: z.literal("element-picked"),
    anchor: elementAnchorSchema,
    rect: htmlCanvasRectSchema,
  }),
  // After each set-annotations application (and each repaint on resize or DOM
  // mutation): which anchors resolved and where. Unresolved anchors render as
  // "orphaned" in the panel instead of painting anything.
  z.object({
    channel: z.literal(HTML_CANVAS_CHANNEL),
    type: z.literal("annotations-resolved"),
    results: z.array(
      z.object({
        id: z.string(),
        resolved: z.boolean(),
        rect: htmlCanvasRectSchema.optional(),
      }),
    ),
  }),
  // The user clicked a pin or highlight — the host opens that thread.
  z.object({
    channel: z.literal(HTML_CANVAS_CHANNEL),
    type: z.literal("marker-clicked"),
    id: z.string(),
    rect: htmlCanvasRectSchema.optional(),
  }),
  // A shim-internal failure, surfaced for logging; never blocks the artifact.
  z.object({
    channel: z.literal(HTML_CANVAS_CHANNEL),
    type: z.literal("error"),
    message: z.string(),
  }),
]);
export type HtmlCanvasToHostMessage = z.infer<
  typeof htmlCanvasToHostMessageSchema
>;
