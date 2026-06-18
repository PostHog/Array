import { z } from "zod";

export const archivedTaskSchema = z.object({
  taskId: z.string(),
  archivedAt: z.string(),
  folderId: z.string(),
  mode: z.enum(["worktree", "local", "cloud"]),
  worktreeName: z.string().nullable(),
  branchName: z.string().nullable(),
  checkpointId: z.string().nullable(),
});

export type ArchivedTask = z.infer<typeof archivedTaskSchema>;

export const archiveTaskInput = z.object({
  taskId: z.string(),
});

export type ArchiveTaskInput = z.infer<typeof archiveTaskInput>;

export const unarchiveTaskInput = z.object({
  taskId: z.string(),
  recreateBranch: z.boolean().optional(),
});

export type UnarchiveTaskInput = z.infer<typeof unarchiveTaskInput>;

export const archiveTaskOutput = archivedTaskSchema;

export const unarchiveTaskOutput = z.object({
  taskId: z.string(),
  worktreeName: z.string().nullable(),
});

export const listArchivedTasksOutput = z.array(archivedTaskSchema);

export const archivedTaskIdsOutput = z.array(z.string());

export const deleteArchivedTaskInput = z.object({
  taskId: z.string(),
});

export const deleteArchivedTaskOutput = z.void();
