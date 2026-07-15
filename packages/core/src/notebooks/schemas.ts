import type {
  NotebookMarkdownUpdate,
  NotebookTextChange,
} from "@posthog/api-client/posthog-client";
import type { Notebook, NotebookMinimal } from "@posthog/api-client/types";
import { z } from "zod";

// Notebook boundary shapes. The generated OpenAPI types are the source of
// truth for fields (the api-client owns the HTTP boundary); zod is kept only
// for the minimal sanity check core runs before a payload reaches the domain
// store.

/** Full notebook as returned by retrieve/create/patch/markdown_save. */
export type NotebookRecord = Notebook;
/** List row (`GET /notebooks/` results) — no `content` field. */
export type NotebookListItem = NotebookMinimal;
/** A text splice `{ from, to, insert }` on the markdown string. */
export type TextChange = NotebookTextChange;
/** One missed remote update from a markdown_save 409 body. */
export type { NotebookMarkdownUpdate };

// Minimal validation of list rows before they enter the notebooks store:
// only the fields core logic relies on; unknown keys pass through untouched.
export const notebookListItemSchema = z
  .looseObject({
    short_id: z.string(),
    title: z.string().nullish(),
    created_at: z.string(),
    last_modified_at: z.string(),
  })
  .array();

// The single-call contract of the AI node editor: one model reply carries
// BOTH the full replacement props and the fresh human-readable summary.
export const notebookNodeAIChangeResponseSchema = z.object({
  props: z.record(z.string(), z.unknown()),
  summary: z.string().trim().min(1),
});

export type NotebookNodeAIChangeResponse = z.infer<
  typeof notebookNodeAIChangeResponseSchema
>;
