import { z } from "zod";

// Base schemas
// Note: "root" is deprecated, migrated to "local" on read
export const workspaceModeSchema = z
  .enum(["worktree", "local", "cloud", "root"])
  .transform((val) => (val === "root" ? "local" : val));
export const worktreeInfoSchema = z.object({
  worktreePath: z.string(),
  worktreeName: z.string(),
  branchName: z.string().nullable(),
  baseBranch: z.string(),
  createdAt: z.string(),
  output: z.string().optional(),
});

export const workspaceInfoSchema = z.object({
  taskId: z.string(),
  mode: workspaceModeSchema,
  worktree: worktreeInfoSchema.nullable(),
  branchName: z.string().nullable(),
  linkedBranch: z.string().nullable(),
});

export const workspaceSchema = z.object({
  taskId: z.string(),
  folderId: z.string(),
  folderPath: z.string(),
  mode: workspaceModeSchema,
  worktreePath: z.string().nullable(),
  worktreeName: z.string().nullable(),
  branchName: z.string().nullable(),
  baseBranch: z.string().nullable(),
  linkedBranch: z.string().nullable(),
  createdAt: z.string(),
});

// Input schemas
export const createWorkspaceInput = z
  .object({
    taskId: z.string(),
    mainRepoPath: z.string(),
    folderId: z.string(),
    folderPath: z.string(),
    mode: workspaceModeSchema,
    branch: z.string().optional(),
    useExistingBranch: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.mode === "cloud" ||
      (data.mainRepoPath.length >= 2 && data.folderPath.length >= 2),
    {
      message: "Repository and folder paths must be valid for non-cloud mode",
    },
  );

export const deleteWorkspaceInput = z.object({
  taskId: z.string(),
  mainRepoPath: z.string(),
});

export const verifyWorkspaceInput = z.object({
  taskId: z.string(),
});

export const getWorkspaceInfoInput = z.object({
  taskId: z.string(),
});

// Output schemas
export const createWorkspaceOutput = workspaceInfoSchema;
export const verifyWorkspaceOutput = z.object({
  exists: z.boolean(),
  missingPath: z.string().optional(),
});
export const getWorkspaceInfoOutput = workspaceInfoSchema.nullable();
export const getAllWorkspacesOutput = z.record(z.string(), workspaceSchema);

export const workspaceErrorPayload = z.object({
  taskId: z.string(),
  message: z.string(),
});

export const workspaceWarningPayload = z.object({
  taskId: z.string(),
  title: z.string(),
  message: z.string(),
});

export const workspacePromotedPayload = z.object({
  taskId: z.string(),
  worktree: worktreeInfoSchema,
  fromBranch: z.string(),
});

export const branchChangedPayload = z.object({
  taskId: z.string(),
  branchName: z.string().nullable(),
});

export const linkedBranchChangedPayload = z.object({
  taskId: z.string(),
  branchName: z.string().nullable(),
});

export const linkBranchInput = z.object({
  taskId: z.string(),
  branchName: z.string(),
});

export const unlinkBranchInput = z.object({
  taskId: z.string(),
});

export const localBackgroundedPayload = z.object({
  mainRepoPath: z.string(),
  localWorktreePath: z.string(),
  branch: z.string(),
});

export const localForegroundedPayload = z.object({
  mainRepoPath: z.string(),
});

// Input/output schemas for local workspace backgrounding
export const isLocalBackgroundedInput = z.object({
  mainRepoPath: z.string(),
});

export const isLocalBackgroundedOutput = z.boolean();

export const getLocalWorktreePathInput = z.object({
  mainRepoPath: z.string(),
});

export const getLocalWorktreePathOutput = z.string();

export const backgroundLocalWorkspaceInput = z.object({
  mainRepoPath: z.string(),
  branch: z.string(),
});

export const backgroundLocalWorkspaceOutput = z.string().nullable();

export const foregroundLocalWorkspaceInput = z.object({
  mainRepoPath: z.string(),
});

export const foregroundLocalWorkspaceOutput = z.boolean();

export const getLocalTasksInput = z.object({
  mainRepoPath: z.string(),
});

export const localTaskSchema = z.object({
  taskId: z.string(),
});

export const getLocalTasksOutput = z.array(localTaskSchema);

export const getWorktreeTasksInput = z.object({
  worktreePath: z.string(),
});

export const getWorktreeTasksOutput = z.array(localTaskSchema);

export const listGitWorktreesInput = z.object({
  mainRepoPath: z.string(),
});

export const gitWorktreeEntrySchema = z.object({
  worktreePath: z.string(),
  head: z.string(),
  branch: z.string().nullable(),
  taskIds: z.array(z.string()),
});

export const listGitWorktreesOutput = z.array(gitWorktreeEntrySchema);

export const getWorktreeSizeInput = z.object({
  worktreePath: z.string(),
});

export const getWorktreeSizeOutput = z.object({
  sizeBytes: z.number(),
});

export const deleteWorktreeInput = z.object({
  worktreePath: z.string(),
  mainRepoPath: z.string(),
});

export const togglePinInput = z.object({
  taskId: z.string(),
});

export const togglePinOutput = z.object({
  isPinned: z.boolean(),
  pinnedAt: z.string().nullable(),
});

export const markViewedInput = z.object({
  taskId: z.string(),
});

export const markActivityInput = z.object({
  taskId: z.string(),
});

export const getPinnedTaskIdsOutput = z.array(z.string());

export const getTaskTimestampsInput = z.object({
  taskId: z.string(),
});

export const getTaskTimestampsOutput = z.object({
  pinnedAt: z.string().nullable(),
  lastViewedAt: z.string().nullable(),
  lastActivityAt: z.string().nullable(),
});

export const getAllTaskTimestampsOutput = z.record(
  z.string(),
  z.object({
    pinnedAt: z.string().nullable(),
    lastViewedAt: z.string().nullable(),
    lastActivityAt: z.string().nullable(),
  }),
);

// Task PR status
export const taskPrStatusInput = z.object({
  taskId: z.string(),
  cloudPrUrl: z.string().nullable(),
});

export const sidebarPrStateSchema = z
  .enum(["merged", "open", "draft", "closed"])
  .nullable();

export const taskPrStatusOutput = z.object({
  prState: sidebarPrStateSchema,
  hasDiff: z.boolean(),
});

export type TaskPrStatusInput = z.infer<typeof taskPrStatusInput>;
export type SidebarPrState = z.infer<typeof sidebarPrStateSchema>;
export type TaskPrStatus = z.infer<typeof taskPrStatusOutput>;

// Type exports
export type WorkspaceMode = z.infer<typeof workspaceModeSchema>;
export type WorktreeInfo = z.infer<typeof worktreeInfoSchema>;
export type WorkspaceInfo = z.infer<typeof workspaceInfoSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInput>;
export type DeleteWorkspaceInput = z.infer<typeof deleteWorkspaceInput>;
export type VerifyWorkspaceInput = z.infer<typeof verifyWorkspaceInput>;
export type GetWorkspaceInfoInput = z.infer<typeof getWorkspaceInfoInput>;
export type ListGitWorktreesInput = z.infer<typeof listGitWorktreesInput>;
export type GetWorktreeSizeInput = z.infer<typeof getWorktreeSizeInput>;
export type DeleteWorktreeInput = z.infer<typeof deleteWorktreeInput>;
export type WorkspaceErrorPayload = z.infer<typeof workspaceErrorPayload>;
export type WorkspaceWarningPayload = z.infer<typeof workspaceWarningPayload>;
export type WorkspacePromotedPayload = z.infer<typeof workspacePromotedPayload>;
export type BranchChangedPayload = z.infer<typeof branchChangedPayload>;
export type LinkedBranchChangedPayload = z.infer<
  typeof linkedBranchChangedPayload
>;
export type LinkBranchInput = z.infer<typeof linkBranchInput>;
export type UnlinkBranchInput = z.infer<typeof unlinkBranchInput>;
export type LocalBackgroundedPayload = z.infer<typeof localBackgroundedPayload>;
export type LocalForegroundedPayload = z.infer<typeof localForegroundedPayload>;
export type IsLocalBackgroundedInput = z.infer<typeof isLocalBackgroundedInput>;
export type GetLocalWorktreePathInput = z.infer<
  typeof getLocalWorktreePathInput
>;
