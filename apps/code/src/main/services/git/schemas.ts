import { z } from "zod";

// Common schemas
export const directoryPathInput = z.object({
  directoryPath: z.string(),
});

export const gitFileStatusSchema = z.enum([
  "modified",
  "added",
  "deleted",
  "renamed",
  "untracked",
]);

export type GitFileStatus = z.infer<typeof gitFileStatusSchema>;

export const changedFileSchema = z.object({
  path: z.string(),
  status: gitFileStatusSchema,
  originalPath: z.string().optional(),
  linesAdded: z.number().optional(),
  linesRemoved: z.number().optional(),
  staged: z.boolean().optional(),
  patch: z.string().optional(),
});

export type ChangedFile = z.infer<typeof changedFileSchema>;

export const diffStatsSchema = z.object({
  filesChanged: z.number(),
  linesAdded: z.number(),
  linesRemoved: z.number(),
});

export type DiffStats = z.infer<typeof diffStatsSchema>;

export const gitSyncStatusSchema = z.object({
  aheadOfRemote: z.number(),
  behind: z.number(),
  aheadOfDefault: z.number(),
  hasRemote: z.boolean(),
  currentBranch: z.string().nullable(),
  isFeatureBranch: z.boolean(),
});

export type GitSyncStatus = z.infer<typeof gitSyncStatusSchema>;

export const gitCommitInfoSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  message: z.string(),
  author: z.string(),
  date: z.string(),
});

export type GitCommitInfo = z.infer<typeof gitCommitInfoSchema>;

export const gitRepoInfoSchema = z.object({
  organization: z.string(),
  repository: z.string(),
  currentBranch: z.string().nullable(),
  defaultBranch: z.string(),
  compareUrl: z.string().nullable(),
});

export type GitRepoInfo = z.infer<typeof gitRepoInfoSchema>;

// detectRepo schemas
export const detectRepoInput = z.object({
  directoryPath: z.string(),
});

export const detectRepoOutput = z
  .object({
    organization: z.string(),
    repository: z.string(),
    remote: z.string().optional(),
    branch: z.string().optional(),
  })
  .nullable();

export type DetectRepoInput = z.infer<typeof detectRepoInput>;
export type DetectRepoResult = z.infer<typeof detectRepoOutput>;

// validateRepo schemas
export const validateRepoInput = z.object({
  directoryPath: z.string(),
});

export const validateRepoOutput = z.boolean();

// cloneRepository schemas
export const cloneRepositoryInput = z.object({
  repoUrl: z.string(),
  targetPath: z.string(),
  cloneId: z.string(),
});

export const cloneRepositoryOutput = z.object({
  cloneId: z.string(),
});

export const cloneProgressStatus = z.enum(["cloning", "complete", "error"]);

export const cloneProgressPayload = z.object({
  cloneId: z.string(),
  status: cloneProgressStatus,
  message: z.string(),
});

export type CloneProgressPayload = z.infer<typeof cloneProgressPayload>;

// getChangedFilesHead schemas
export const getChangedFilesHeadInput = directoryPathInput;
export const getChangedFilesHeadOutput = z.array(changedFileSchema);

// getFileAtHead schemas
export const getFileAtHeadInput = z.object({
  directoryPath: z.string(),
  filePath: z.string(),
});
export const getFileAtHeadOutput = z.string().nullable();

// Shared diff schemas (getDiffHead, getDiffCached, getDiffUnstaged)
export const diffInput = z.object({
  directoryPath: z.string(),
  ignoreWhitespace: z.boolean().optional(),
});
export const diffOutput = z.string();

// getDiffStats schemas
export const getDiffStatsInput = directoryPathInput;
export const getDiffStatsOutput = diffStatsSchema;

// stageFiles / unstageFiles shared schema
export const stageFilesInput = z.object({
  directoryPath: z.string(),
  paths: z.array(z.string()),
});

// getCurrentBranch schemas
export const getCurrentBranchInput = directoryPathInput;
export const getCurrentBranchOutput = z.string().nullable();

// getAllBranches schemas
export const getAllBranchesInput = directoryPathInput;
export const getAllBranchesOutput = z.array(z.string());

// createBranch schemas
export const createBranchInput = z.object({
  directoryPath: z.string(),
  branchName: z.string(),
});

export const checkoutBranchInput = z.object({
  directoryPath: z.string(),
  branchName: z.string(),
});
export const checkoutBranchOutput = z.object({
  previousBranch: z.string(),
  currentBranch: z.string(),
});

// discardFileChanges schemas
export const discardFileChangesInput = z.object({
  directoryPath: z.string(),
  filePath: z.string(),
  fileStatus: gitFileStatusSchema,
});

// getGitSyncStatus schemas
export const getGitSyncStatusInput = directoryPathInput;
export const getGitSyncStatusOutput = gitSyncStatusSchema;

// getLatestCommit schemas
export const getLatestCommitInput = directoryPathInput;
export const getLatestCommitOutput = gitCommitInfoSchema.nullable();

// getGitRepoInfo schemas
export const getGitRepoInfoInput = directoryPathInput;
export const getGitRepoInfoOutput = gitRepoInfoSchema.nullable();

// Push operation
export const pushInput = z.object({
  directoryPath: z.string(),
  remote: z.string().default("origin"),
  branch: z.string().optional(),
  setUpstream: z.boolean().default(false),
});

export type PushInput = z.infer<typeof pushInput>;

// Pull operation
export const pullInput = z.object({
  directoryPath: z.string(),
  remote: z.string().default("origin"),
  branch: z.string().optional(),
});

export type PullInput = z.infer<typeof pullInput>;

// Commit operation
export const commitInput = z.object({
  directoryPath: z.string(),
  message: z.string(),
  paths: z.array(z.string()).optional(),
  allowEmpty: z.boolean().optional(),
  stagedOnly: z.boolean().optional(),
  taskId: z.string().optional(),
});

export type CommitInput = z.infer<typeof commitInput>;

// Git CLI status
export const gitStatusOutput = z.object({
  installed: z.boolean(),
  version: z.string().nullable(),
});

export type GitStatusOutput = z.infer<typeof gitStatusOutput>;

// GitHub CLI status
export const ghStatusOutput = z.object({
  installed: z.boolean(),
  version: z.string().nullable(),
  authenticated: z.boolean(),
  username: z.string().nullable(),
  error: z.string().nullable(),
});

export type GhStatusOutput = z.infer<typeof ghStatusOutput>;

export const ghAuthTokenOutput = z.object({
  success: z.boolean(),
  token: z.string().nullable(),
  error: z.string().nullable(),
});

export type GhAuthTokenOutput = z.infer<typeof ghAuthTokenOutput>;

// Pull request status
export const prStatusInput = directoryPathInput;
export const prStatusOutput = z.object({
  hasRemote: z.boolean(),
  isGitHubRepo: z.boolean(),
  currentBranch: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  prExists: z.boolean(),
  prUrl: z.string().nullable(),
  prState: z.string().nullable(),
  baseBranch: z.string().nullable(),
  headBranch: z.string().nullable(),
  isDraft: z.boolean().nullable(),
  error: z.string().nullable(),
});

export type PrStatusInput = z.infer<typeof prStatusInput>;
export type PrStatusOutput = z.infer<typeof prStatusOutput>;

// Look up the PR for an arbitrary branch (not necessarily the current one).
export const getPrUrlForBranchInput = z.object({
  directoryPath: z.string(),
  branchName: z.string(),
});
export const getPrUrlForBranchOutput = z.string().nullable();

export type GetPrUrlForBranchInput = z.infer<typeof getPrUrlForBranchInput>;
export type GetPrUrlForBranchOutput = z.infer<typeof getPrUrlForBranchOutput>;

// Create PR operation
export const createPrInput = z.object({
  directoryPath: z.string(),
  flowId: z.string(),
  branchName: z.string().optional(),
  commitMessage: z.string().optional(),
  prTitle: z.string().optional(),
  prBody: z.string().optional(),
  draft: z.boolean().optional(),
  stagedOnly: z.boolean().optional(),
  taskId: z.string().optional(),
  conversationContext: z.string().optional(),
});

export type CreatePrInput = z.infer<typeof createPrInput>;

// Open PR operation
export const openPrInput = directoryPathInput;
export const openPrOutput = z.object({
  success: z.boolean(),
  message: z.string(),
  prUrl: z.string().nullable(),
});

export type OpenPrInput = z.infer<typeof openPrInput>;
export type OpenPrOutput = z.infer<typeof openPrOutput>;

// Publish (push with upstream) operation
export const publishInput = z.object({
  directoryPath: z.string(),
  remote: z.string().default("origin"),
});

export type PublishInput = z.infer<typeof publishInput>;

// Sync (pull then push) operation
export const syncInput = z.object({
  directoryPath: z.string(),
  remote: z.string().default("origin"),
});

export type SyncInput = z.infer<typeof syncInput>;

// PR Template lookup
export const getPrTemplateInput = directoryPathInput;

export const getPrTemplateOutput = z.object({
  template: z.string().nullable(),
  templatePath: z.string().nullable(),
});

export type GetPrTemplateOutput = z.infer<typeof getPrTemplateOutput>;

// Commit conventions analysis
export const getCommitConventionsInput = z.object({
  directoryPath: z.string(),
  sampleSize: z.number().default(20),
});

export const getCommitConventionsOutput = z.object({
  conventionalCommits: z.boolean(),
  commonPrefixes: z.array(z.string()),
  sampleMessages: z.array(z.string()),
});

export type GetCommitConventionsOutput = z.infer<
  typeof getCommitConventionsOutput
>;

// getPrChangedFiles schemas
export const getPrChangedFilesInput = z.object({
  prUrl: z.string(),
});
export const getPrChangedFilesOutput = z.array(changedFileSchema);

// getPrDetailsByUrl schemas
export const getPrDetailsByUrlInput = z.object({
  prUrl: z.string(),
});
export const getPrDetailsByUrlOutput = z.object({
  state: z.string(),
  merged: z.boolean(),
  draft: z.boolean(),
});
export type PrDetailsByUrlOutput = z.infer<typeof getPrDetailsByUrlOutput>;

// getPrReviewComments schemas
export const prReviewCommentUserSchema = z.object({
  login: z.string(),
  avatar_url: z.string(),
});

export const prReviewCommentSchema = z.object({
  id: z.number(),
  body: z.string(),
  path: z.string(),
  line: z.number().nullable(),
  original_line: z.number().nullable(),
  side: z.enum(["LEFT", "RIGHT"]),
  start_line: z.number().nullable(),
  start_side: z.enum(["LEFT", "RIGHT"]).nullable(),
  diff_hunk: z.string(),
  in_reply_to_id: z.number().nullish(),
  user: prReviewCommentUserSchema,
  created_at: z.string(),
  updated_at: z.string(),
  subject_type: z.enum(["line", "file"]).nullable(),
});

export type PrReviewComment = z.infer<typeof prReviewCommentSchema>;

export const getPrReviewCommentsInput = z.object({
  prUrl: z.string(),
});
export const getPrReviewCommentsOutput = z.array(prReviewCommentSchema);

// replyToPrComment schemas
export const replyToPrCommentInput = z.object({
  prUrl: z.string(),
  commentId: z.number(),
  body: z.string(),
});
export const replyToPrCommentOutput = z.object({
  success: z.boolean(),
  comment: prReviewCommentSchema.nullable(),
});
export type ReplyToPrCommentOutput = z.infer<typeof replyToPrCommentOutput>;

// updatePrByUrl schemas
export const prActionType = z.enum(["close", "reopen", "ready", "draft"]);
export type PrActionType = z.infer<typeof prActionType>;

export const updatePrByUrlInput = z.object({
  prUrl: z.string(),
  action: prActionType,
});
export const updatePrByUrlOutput = z.object({
  success: z.boolean(),
  message: z.string(),
});
export type UpdatePrByUrlOutput = z.infer<typeof updatePrByUrlOutput>;

export const getBranchChangedFilesInput = z.object({
  repo: z.string(),
  branch: z.string(),
});
export const getBranchChangedFilesOutput = z.array(changedFileSchema);

export const getLocalBranchChangedFilesInput = z.object({
  directoryPath: z.string(),
  branch: z.string(),
});
export const getLocalBranchChangedFilesOutput = z.array(changedFileSchema);

export const generateCommitMessageInput = z.object({
  directoryPath: z.string(),
  conversationContext: z.string().optional(),
});

export const generateCommitMessageOutput = z.object({
  message: z.string(),
});

export const generatePrTitleAndBodyInput = z.object({
  directoryPath: z.string(),
  conversationContext: z.string().optional(),
});

export const generatePrTitleAndBodyOutput = z.object({
  title: z.string(),
  body: z.string(),
});

export const gitStateSnapshotSchema = z.object({
  changedFiles: z.array(changedFileSchema).optional(),
  diffStats: diffStatsSchema.optional(),
  syncStatus: gitSyncStatusSchema.optional(),
  latestCommit: gitCommitInfoSchema.nullable().optional(),
  prStatus: prStatusOutput.optional(),
});

export type GitStateSnapshot = z.infer<typeof gitStateSnapshotSchema>;

export const commitOutput = z.object({
  success: z.boolean(),
  message: z.string(),
  commitSha: z.string().nullable(),
  branch: z.string().nullable(),
  state: gitStateSnapshotSchema.optional(),
});

export type CommitOutput = z.infer<typeof commitOutput>;

export const pushOutput = z.object({
  success: z.boolean(),
  message: z.string(),
  state: gitStateSnapshotSchema.optional(),
});

export type PushOutput = z.infer<typeof pushOutput>;

export const pullOutput = z.object({
  success: z.boolean(),
  message: z.string(),
  updatedFiles: z.number().optional(),
  state: gitStateSnapshotSchema.optional(),
});

export type PullOutput = z.infer<typeof pullOutput>;

export const publishOutput = z.object({
  success: z.boolean(),
  message: z.string(),
  branch: z.string(),
  state: gitStateSnapshotSchema.optional(),
});

export type PublishOutput = z.infer<typeof publishOutput>;

export const syncOutput = z.object({
  success: z.boolean(),
  pullMessage: z.string(),
  pushMessage: z.string(),
  state: gitStateSnapshotSchema.optional(),
});

export type SyncOutput = z.infer<typeof syncOutput>;

export const createPrStep = z.enum([
  "creating-branch",
  "committing",
  "pushing",
  "creating-pr",
  "complete",
  "error",
]);

export type CreatePrStep = z.infer<typeof createPrStep>;

export const createPrOutput = z.object({
  success: z.boolean(),
  message: z.string(),
  prUrl: z.string().nullable(),
  failedStep: createPrStep.nullable(),
  state: gitStateSnapshotSchema.optional(),
});

export type CreatePrOutput = z.infer<typeof createPrOutput>;

export const discardFileChangesOutput = z.object({
  success: z.boolean(),
  state: gitStateSnapshotSchema.optional(),
});

export type DiscardFileChangesOutput = z.infer<typeof discardFileChangesOutput>;

export const githubRefKindSchema = z.enum(["issue", "pr"]);
export type GithubRefKind = z.infer<typeof githubRefKindSchema>;

export const githubRefStateSchema = z.enum(["OPEN", "CLOSED", "MERGED"]);
export type GithubRefState = z.infer<typeof githubRefStateSchema>;

export const githubRefSchema = z.object({
  kind: githubRefKindSchema,
  number: z.number(),
  title: z.string(),
  state: githubRefStateSchema,
  labels: z.array(z.string()),
  url: z.string(),
  repo: z.string(),
  isDraft: z.boolean().optional(),
});

export type GithubRef = z.infer<typeof githubRefSchema>;

// Legacy alias kept so callers that previously consumed only issues continue to work.
export const githubIssueStateSchema = githubRefStateSchema;
export type GithubIssueState = GithubRefState;
export const githubIssueSchema = githubRefSchema;
export type GitHubIssue = GithubRef;
export type GithubPullRequest = GithubRef;

export const searchGithubRefsInput = z.object({
  directoryPath: z.string(),
  query: z.string().optional(),
  limit: z.number().default(25),
  kinds: z.array(githubRefKindSchema).optional(),
});

export const searchGithubRefsOutput = z.array(githubRefSchema);

export const getGithubIssueInput = z.object({
  owner: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
});

export const getGithubIssueOutput = githubRefSchema.nullable();

export const getGithubPullRequestInput = getGithubIssueInput;

export const getGithubPullRequestOutput = getGithubIssueOutput;

export const createPrProgressPayload = z.object({
  flowId: z.string(),
  step: createPrStep,
  message: z.string(),
  prUrl: z.string().optional(),
});

export type CreatePrProgressPayload = z.infer<typeof createPrProgressPayload>;
