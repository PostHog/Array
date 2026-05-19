import type { PostHogAPIClient } from "@posthog/agent/posthog-api";
import { handoffLocalGitStateSchema } from "@posthog/agent/server/schemas";
import { z } from "zod";
import type { WorkspaceMode } from "../../db/repositories/workspace-repository";

const handoffBaseInput = z.object({
  taskId: z.string(),
  runId: z.string(),
  repoPath: z.string(),
});

const handoffApiInput = handoffBaseInput.extend({
  apiHost: z.string(),
  teamId: z.number(),
});

export const handoffErrorCodeSchema = z.enum(["github_authorization_required"]);

export type HandoffErrorCode = z.infer<typeof handoffErrorCodeSchema>;

const handoffBaseResult = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  code: handoffErrorCodeSchema.optional(),
});

export const handoffPreflightInput = handoffApiInput;

export type HandoffPreflightInput = z.infer<typeof handoffPreflightInput>;

export const handoffPreflightResult = z.object({
  canHandoff: z.boolean(),
  reason: z.string().optional(),
  localTreeDirty: z.boolean(),
  localGitState: handoffLocalGitStateSchema.optional(),
  changedFiles: z
    .array(
      z.object({
        path: z.string(),
        status: z.enum([
          "modified",
          "added",
          "deleted",
          "renamed",
          "untracked",
        ]),
        linesAdded: z.number().optional(),
        linesRemoved: z.number().optional(),
      }),
    )
    .optional(),
});

export type HandoffPreflightResult = z.infer<typeof handoffPreflightResult>;

export const handoffExecuteInput = handoffApiInput.extend({
  sessionId: z.string().optional(),
  adapter: z.enum(["claude", "codex"]).optional(),
  localGitState: handoffLocalGitStateSchema.optional(),
});

export type HandoffExecuteInput = z.infer<typeof handoffExecuteInput>;

export const handoffExecuteResult = handoffBaseResult.extend({
  sessionId: z.string().optional(),
});

export type HandoffExecuteResult = z.infer<typeof handoffExecuteResult>;

export const handoffToCloudPreflightInput = handoffBaseInput;

export type HandoffToCloudPreflightInput = z.infer<
  typeof handoffToCloudPreflightInput
>;

export const handoffToCloudPreflightResult = z.object({
  canHandoff: z.boolean(),
  reason: z.string().optional(),
  localGitState: handoffLocalGitStateSchema.optional(),
});

export type HandoffToCloudPreflightResult = z.infer<
  typeof handoffToCloudPreflightResult
>;

export const handoffToCloudExecuteInput = handoffApiInput.extend({
  localGitState: handoffLocalGitStateSchema.optional(),
});

export type HandoffToCloudExecuteInput = z.infer<
  typeof handoffToCloudExecuteInput
>;

export const handoffToCloudExecuteResult = handoffBaseResult.extend({
  logEntryCount: z.number().optional(),
});

export type HandoffToCloudExecuteResult = z.infer<
  typeof handoffToCloudExecuteResult
>;

export type HandoffStep =
  | "fetching_logs"
  | "applying_git_checkpoint"
  | "spawning_agent"
  | "capturing_checkpoint"
  | "stopping_agent"
  | "starting_cloud_run"
  | "complete"
  | "failed";

export interface HandoffProgressPayload {
  taskId: string;
  step: HandoffStep;
  message: string;
}

export const HandoffEvent = {
  Progress: "handoff-progress",
} as const;

export interface HandoffServiceEvents {
  [HandoffEvent.Progress]: HandoffProgressPayload;
}

export interface HandoffBaseDeps {
  createApiClient(apiHost: string, teamId: number): PostHogAPIClient;
  killSession(taskRunId: string): Promise<void>;
  updateWorkspaceMode(taskId: string, mode: WorkspaceMode): void;
  onProgress(step: HandoffStep, message: string): void;
}
