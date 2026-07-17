import { z } from "zod";
import { freeformVersionSchema } from "./freeformSchemas";

// The workflow attached to a WORKFLOW canvas. A workflow canvas is a canvas
// (dashboard row) with this link in its meta; the workflow itself lives in
// PostHog cloud and is only referenced here (PRD §3). Written host-side after a
// successful workflow build (the agent can't persist it - see the workflow
// link primitive), and read to render the status badge + link-out.
export const workflowLinkSchema = z.object({
  // The PostHog HogFlow id this canvas tracks.
  workflowId: z.string(),
  // What the workflow does (alert / marketing / batch …). Optional - used for
  // display only; absent when it couldn't be classified deterministically.
  workflowType: z.string().optional(),
  // The workflow's status at link time (e.g. "draft"). Optional; drives the
  // badge text. Not kept live - refreshed only when a new build runs.
  workflowStatus: z.string().optional(),
});
export type WorkflowLink = z.infer<typeof workflowLinkSchema>;

export const dashboardRecordSchema = z.object({
  id: z.string(),
  // The channel (desktop file-system folder) this dashboard belongs to.
  // Defaults to "" so dashboards saved before channel scoping still parse;
  // they read as orphans and get adopted into the default channel on load.
  channelId: z.string().default(""),
  name: z.string(),
  // The canvas template this board was built with. Defaults to "freeform" so
  // boards saved before templating still parse and behave as before.
  templateId: z.string().default("freeform"),
  // The live single-file React source, and its edit history.
  code: z.string().optional(),
  versions: z.array(freeformVersionSchema).optional(),
  currentVersionId: z.string().optional(),
  // The live author-written context (markdown) passed to the agent.
  context: z.string().optional(),
  // Id of the task currently generating this canvas (freeform gen runs as a
  // dedicated task, like CONTEXT.md). null/absent = no generation in flight.
  generationTaskId: z.string().nullish(),
  // Display name of whoever created the file-system row (from the backend's
  // `created_by` user). Absent for rows the API returns without a creator.
  createdBy: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  // Epoch ms the canvas was pinned to its channel; absent = not pinned. Stored
  // in the row's meta, so a pin is shared across all users of the channel.
  pinnedAt: z.number().optional(),
  // The attached workflow (workflow canvases only). Absent for regular
  // canvases and for a workflow canvas whose build hasn't linked one yet.
  workflow: workflowLinkSchema.optional(),
});
export type DashboardRecord = z.infer<typeof dashboardRecordSchema>;

// What a dashboard stores in its desktop file-system row's free-form `meta` JSON
// blob. The FileSystem row itself carries id/path/type/created_at; everything
// below is our own payload that the model has no columns for. Documenting the
// shape here keeps the otherwise-untyped `meta` honest.
export const dashboardFileMetaSchema = z.object({
  // The channel folder's stable file-system id. Stored here rather than derived
  // from the path so renaming/moving the channel folder can't reparent the board.
  channelId: z.string().optional(),
  // The canvas template id this board was built with (absent = "freeform").
  templateId: z.string().optional(),
  // Live React source + ordered edit history + the live pointer.
  code: z.string().optional(),
  versions: z.array(freeformVersionSchema).optional(),
  currentVersionId: z.string().optional(),
  // The live author-written context (markdown) passed to the agent.
  context: z.string().optional(),
  // Id of the task currently generating this canvas (see dashboardRecordSchema).
  generationTaskId: z.string().nullish(),
  // Display name of the creator, stamped at create time. We can't rely on the
  // FS row's `created_by` (the list endpoint doesn't expand it), so we store our
  // own. Absent on boards created before this field existed.
  createdBy: z.string().optional(),
  // Epoch ms. createdAt mirrors the row's created_at; updatedAt is ours because
  // the FileSystem row has no updated_at column to sort the dashboards list by.
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
  // Channel folders only: the file-system id of the channel's home canvas (the
  // auto-created freeform board shown when the channel name is clicked). Stored
  // on the folder's meta because the FileSystem model has no column for it.
  homeCanvasId: z.string().optional(),
  // Epoch ms the canvas was pinned to its channel; absent = not pinned. Lives in
  // meta (the shared backend row) so a pin is visible to every channel member.
  pinnedAt: z.number().optional(),
  // The attached workflow for a workflow canvas (PRD §3). Lives in meta so
  // the link is shared across every client, like the other canvas metadata.
  workflow: workflowLinkSchema.optional(),
});
export type DashboardFileMeta = z.infer<typeof dashboardFileMetaSchema>;

export const dashboardSummarySchema = z.object({
  id: z.string(),
  channelId: z.string(),
  name: z.string(),
  templateId: z.string().default("freeform"),
  createdBy: z.string().optional(),
  updatedAt: z.number(),
  // The React source, included so the grid can render a live preview without an
  // N+1 of get()s (it rides in the FS row's meta, already loaded when listing).
  code: z.string().optional(),
  // Id of the task currently generating this canvas (see dashboardRecordSchema).
  // Surfaced on the summary so the sidebar can show the run nested under the
  // canvas without a per-canvas get().
  generationTaskId: z.string().nullish(),
  // Epoch ms the canvas was pinned to its channel; absent = not pinned. On the
  // summary so the Pinned menu can filter/sort without a per-canvas get().
  pinnedAt: z.number().optional(),
  // The attached workflow (workflow canvases only). On the summary so the
  // Artifacts list can show the workflow's status without a per-canvas get().
  workflow: workflowLinkSchema.optional(),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const listDashboardsInput = z.object({ channelId: z.string().min(1) });

export const createDashboardInput = z.object({
  channelId: z.string().min(1),
  name: z.string().min(1),
  templateId: z.string().default("freeform"),
});

export const saveFreeformInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  code: z.string(),
  versions: z.array(freeformVersionSchema),
  currentVersionId: z.string().optional(),
  // The live author-written context (markdown). Persisted alongside code so the
  // Context tab survives reloads and rides into every agent turn.
  context: z.string().optional(),
});

export const dashboardIdInput = z.object({ id: z.string().min(1) });

export const ensureHomeCanvasInput = z.object({
  channelId: z.string().min(1),
});

// Rename a canvas (changes the last path segment, i.e. its display title).
export const renameDashboardInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

// Set (or clear, when taskId is null) the canvas's generation-task association.
// Stored in the row's meta so every client polling the canvas sees the run.
export const setGenerationTaskInput = z.object({
  id: z.string().min(1),
  taskId: z.string().nullable(),
});

// Pin (or unpin) a canvas to its channel. Persisted in the row's meta so the
// pin is shared across every user of the channel.
export const setPinnedInput = z.object({
  id: z.string().min(1),
  pinned: z.boolean(),
});

// Attach (link) a workflow to a canvas, making it a workflow canvas. Written
// host-side after a successful workflow build; merged into the row's meta like
// the other writers.
export const setWorkflowInput = z.object({
  id: z.string().min(1),
  workflow: workflowLinkSchema,
});
