import {
  createSignedCommit,
  createSignedRewrite,
  type SignedCommitCtx,
  type SignedCommitInput,
  type SignedCommitResult,
  type SignedRewriteInput,
} from "@posthog/git/signed-commit";
import { z } from "zod";
import { qualifiedLocalToolName } from "./local-tools/registry";

/**
 * Shared definitions for the `git_signed_commit` tool, used by the local-tools
 * registry entry (which both adapters expose) so the tool name, schema,
 * description, and result formatting can't drift. The qualified name also
 * appears in the cloud system prompt and the PreToolUse guard message.
 */

export const SIGNED_COMMIT_TOOL_NAME = "git_signed_commit";
export const SIGNED_COMMIT_QUALIFIED_TOOL_NAME = qualifiedLocalToolName(
  SIGNED_COMMIT_TOOL_NAME,
);

export const SIGNED_COMMIT_TOOL_DESCRIPTION =
  "Create a GitHub-signed (Verified) commit on the branch. Stage files with `git add` " +
  "first (or pass `paths`), then call this instead of `git commit`/`git push` — those are " +
  "blocked because all commits must be signed. The commit is created via GitHub's API and " +
  "your local checkout is kept in sync. For a new branch, pass `branch` (prefixed with " +
  "`posthog-code/`) and the tool creates it on the remote.";

export const signedCommitToolSchema = {
  message: z.string().describe("Commit headline (first line)."),
  body: z.string().optional().describe("Optional extended commit body."),
  branch: z
    .string()
    .optional()
    .describe(
      "Target branch; defaults to the current branch. Use a posthog-code/ prefix for new branches.",
    ),
  paths: z
    .array(z.string())
    .optional()
    .describe(
      "Files to stage before committing; defaults to already-staged files.",
    ),
  cwd: z
    .string()
    .optional()
    .describe(
      "Path to the git checkout to commit from; defaults to the session's working directory. " +
        "Pass this when committing to a clone outside the session cwd (e.g. a sibling repo cloned during the run). " +
        "Relative paths resolve against the session cwd.",
    ),
};

export const SIGNED_REWRITE_TOOL_NAME = "git_signed_rewrite";
export const SIGNED_REWRITE_QUALIFIED_TOOL_NAME = qualifiedLocalToolName(
  SIGNED_REWRITE_TOOL_NAME,
);

export const SIGNED_REWRITE_TOOL_DESCRIPTION =
  "Force-update a branch with GitHub-signed (Verified) history, the signed-commit equivalent " +
  "of `git push --force`. First rebase/merge locally with normal `git` (resolving conflicts and " +
  "finishing with `git rebase --continue`, NOT `git commit`); then call this to republish the " +
  "branch's commits as Verified and atomically move the remote branch onto them. Use this to " +
  "update an existing PR after a rebase or conflict fix. Rewrites the current branch by default.";

export const signedRewriteToolSchema = {
  branch: z
    .string()
    .optional()
    .describe("Branch to rewrite; defaults to the current branch."),
  onto: z
    .string()
    .optional()
    .describe(
      "Commit/ref the rewritten history sits on (e.g. origin/master). " +
        "Defaults to the merge-base of the current branch with the repo's default branch.",
    ),
  cwd: z
    .string()
    .optional()
    .describe(
      "Path to the git checkout to rewrite; defaults to the session's working directory. " +
        "Relative paths resolve against the session cwd.",
    ),
};

export interface SignedCommitToolResult {
  content: { type: "text"; text: string }[];
  isError?: true;
  // Both SDKs' CallToolResult carries an open `_meta`/index signature; mirror it
  // so this shape is assignable to either adapter's tool-handler return type.
  [key: string]: unknown;
}

async function runSignedTool<A>(
  toolName: string,
  op: (ctx: SignedCommitCtx, args: A) => Promise<SignedCommitResult>,
  lead: (result: SignedCommitResult) => string,
  ctx: SignedCommitCtx,
  args: A,
): Promise<SignedCommitToolResult> {
  try {
    const result = await op(ctx, args);
    const list = result.commits.map((c) => `- ${c.sha} ${c.url}`).join("\n");
    return { content: [{ type: "text", text: `${lead(result)}:\n${list}` }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `${toolName} failed: ${message}` }],
      isError: true,
    };
  }
}

export function runSignedCommitTool(
  ctx: SignedCommitCtx,
  args: SignedCommitInput,
): Promise<SignedCommitToolResult> {
  return runSignedTool(
    SIGNED_COMMIT_TOOL_NAME,
    createSignedCommit,
    (r) => `Created ${r.commits.length} signed commit(s) on ${r.branch}`,
    ctx,
    args,
  );
}

export function runSignedRewriteTool(
  ctx: SignedCommitCtx,
  args: SignedRewriteInput,
): Promise<SignedCommitToolResult> {
  return runSignedTool(
    SIGNED_REWRITE_TOOL_NAME,
    createSignedRewrite,
    (r) =>
      `Force-updated ${r.branch} with ${r.commits.length} signed commit(s)`,
    ctx,
    args,
  );
}
