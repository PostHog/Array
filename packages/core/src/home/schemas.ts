import { z } from "zod";
import { situationId } from "../workflow/schemas";
import { prSnapshot } from "./prSnapshot";

// The Home snapshot wire contract. Produced server-side by PostHog's
// `evaluate-code-workstreams` Temporal worker and served by
// `GET /api/projects/:id/code_home/`; the snapshot query validates the
// response against this schema before handing it to the UI.

// Mirrors TaskRunStatus in @posthog/shared (the canonical type lives there;
// this is the runtime enum the snapshot schema validates against).
export const taskRunStatus = z.enum([
  "not_started",
  "queued",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
]);

export const homeActiveAgent = z
  .object({
    taskId: z.string(),
    title: z.string(),
    repoName: z.string().nullable(),
    branch: z.string().nullable(),
    status: taskRunStatus,
    lastActivityAt: z.number(),
    needsPermission: z.boolean(),
    cloudPrUrl: z.string().nullable(),
  })
  .strict();
export type HomeActiveAgent = z.infer<typeof homeActiveAgent>;

export const homeWorkstreamTask = z
  .object({
    id: z.string(),
    title: z.string(),
    status: taskRunStatus.nullable(),
    isGenerating: z.boolean(),
    needsPermission: z.boolean(),
    // Label of the Home quick action that started this run, when it came from one.
    // Optional for tolerance of snapshots produced before this field shipped.
    quickAction: z.string().nullable().optional(),
  })
  .strict();
export type HomeWorkstreamTask = z.infer<typeof homeWorkstreamTask>;

export const homeWorkstream = z
  .object({
    id: z.string(),
    repoName: z.string().nullable(),
    repoFullPath: z.string().nullable(),
    branch: z.string().nullable(),
    prUrl: z.string().nullable(),
    pr: prSnapshot.nullable(),
    tasks: z.array(homeWorkstreamTask),
    situations: z.array(situationId),
    // The board column to place this workstream in, picked server-side from
    // `situations` by priority. Null when no situation applies.
    primarySituation: situationId.nullable(),
    lastActivityAt: z.number(),
  })
  .strict();
export type HomeWorkstream = z.infer<typeof homeWorkstream>;

export const homeSnapshot = z
  .object({
    activeAgents: z.array(homeActiveAgent),
    needsAttention: z.array(homeWorkstream),
    inProgress: z.array(homeWorkstream),
  })
  .strict();
export type HomeSnapshot = z.infer<typeof homeSnapshot>;

export const EMPTY_HOME_SNAPSHOT: HomeSnapshot = {
  activeAgents: [],
  needsAttention: [],
  inProgress: [],
};
