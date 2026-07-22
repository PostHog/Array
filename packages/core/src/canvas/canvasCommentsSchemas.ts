import { z } from "zod";
import { commentAnchorSchema } from "./htmlCanvasSchemas";

// The comments scope for canvas artifacts on PostHog's generic comments API
// (`scope` is a free-form discriminator there). One constant so every reader
// and writer agrees; `item_id` is the canvas's file-system row id.
export const CANVAS_COMMENTS_SCOPE = "code_canvas";

// What we store in a comment's `item_context` JSON. Roots carry the anchor
// (where in the document the comment points); replies carry no anchor — they
// inherit their root's. `canvasVersionId` records which canvas version the
// anchor was made against, for diagnostics and a future "view at that version".
export const canvasCommentContextSchema = z.object({
  version: z.literal(1),
  anchor: commentAnchorSchema.optional(),
  canvasVersionId: z.string().optional(),
});
export type CanvasCommentContext = z.infer<typeof canvasCommentContextSchema>;

// A canvas comment as the app consumes it — parsed from the API row, with the
// anchor already extracted from `item_context` (null = page-level, a reply, or
// an unparseable/foreign context; the panel treats null as unanchored).
export const canvasCommentSchema = z.object({
  id: z.string(),
  content: z.string(),
  createdAt: z.number(),
  createdBy: z.object({
    uuid: z.string(),
    name: z.string(),
    email: z.string(),
  }),
  anchor: commentAnchorSchema.nullable(),
  sourceCommentId: z.string().nullable(),
});
export type CanvasComment = z.infer<typeof canvasCommentSchema>;

// A root comment with its replies. `index` is the 1-based pin number painted
// in the document and shown beside the thread in the panel.
export const canvasCommentThreadSchema = z.object({
  root: canvasCommentSchema,
  replies: z.array(canvasCommentSchema),
  index: z.number().int(),
});
export type CanvasCommentThread = z.infer<typeof canvasCommentThreadSchema>;
