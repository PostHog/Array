import { z } from "zod";

// PR review comment domain types. Shared between the git host service (which
// fetches them via the gh API) and the code-review UI (which renders them).
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

export const prReviewThreadSchema = z.object({
  nodeId: z.string(),
  isResolved: z.boolean(),
  rootId: z.number(),
  filePath: z.string(),
  comments: z.array(prReviewCommentSchema),
});
export type PrReviewThread = z.infer<typeof prReviewThreadSchema>;

// GitHub ref (issue/PR) domain types. Shared between the git host service
// (gh search/lookup) and the message-editor issue chips + sidebar github refs.
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

// Legacy aliases kept so callers that previously consumed only issues continue to work.
export const githubIssueStateSchema = githubRefStateSchema;
export type GithubIssueState = GithubRefState;
export const githubIssueSchema = githubRefSchema;
export type GitHubIssue = GithubRef;
export type GithubPullRequest = GithubRef;

// PR action intent. Shared between the git host service (updatePrByUrl) and the
// git-interaction UI (PR status menu actions).
export const prActionTypeSchema = z.enum(["close", "reopen", "ready", "draft"]);
export type PrActionType = z.infer<typeof prActionTypeSchema>;
