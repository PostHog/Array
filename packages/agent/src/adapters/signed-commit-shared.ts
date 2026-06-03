import {
  createSignedCommit,
  type SignedCommitCtx,
  type SignedCommitInput,
  type SignedCommitResult,
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

export function formatSignedCommitResult(result: SignedCommitResult): string {
  const list = result.commits.map((c) => `- ${c.sha} ${c.url}`).join("\n");
  return `Created ${result.commits.length} signed commit(s) on ${result.branch}:\n${list}`;
}

export interface SignedCommitToolResult {
  content: { type: "text"; text: string }[];
  isError?: true;
  // Both SDKs' CallToolResult carries an open `_meta`/index signature; mirror it
  // so this shape is assignable to either adapter's tool-handler return type.
  [key: string]: unknown;
}

/**
 * Runs `git_signed_commit` and formats the MCP result. Shared by the Claude
 * in-process tool and the Codex stdio server so success/error formatting (and
 * the error-message prefix) can't drift between adapters.
 */
export async function runSignedCommitTool(
  ctx: SignedCommitCtx,
  args: SignedCommitInput,
): Promise<SignedCommitToolResult> {
  try {
    const result = await createSignedCommit(ctx, args);
    return {
      content: [{ type: "text", text: formatSignedCommitResult(result) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        { type: "text", text: `${SIGNED_COMMIT_TOOL_NAME} failed: ${message}` },
      ],
      isError: true,
    };
  }
}
