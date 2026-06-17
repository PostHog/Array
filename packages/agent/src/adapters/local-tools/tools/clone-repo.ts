import * as path from "node:path";
import { createGitClient } from "@posthog/git/client";
import { getCurrentBranch } from "@posthog/git/queries";
import { CloneSaga } from "@posthog/git/sagas/clone";
import { z } from "zod";
import { resolveGithubToken } from "../../../utils/github-token";
import { defineLocalTool, type LocalToolResult } from "../registry";

const OWNER_REPO_RE = /^[\w.-]+\/[\w.-]+$/;

const cloneRepoSchema = {
  repo: z
    .string()
    .describe(
      "Repository to clone, as 'owner/repo' (preferred) or a full https GitHub URL.",
    ),
  branch: z
    .string()
    .optional()
    .describe(
      "Optional branch to check out. Defaults to the repo's default branch.",
    ),
};

function fail(text: string): LocalToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Lazily brings a repo into a repo-less channel session's scratch workspace.
 * Clones into `<cwd>/repos/<repo>` (a subdir of the session cwd, so no session
 * restart / cwd rebind is needed) and reports the path for the agent to cd into.
 */
export const cloneRepoTool = defineLocalTool({
  name: "clone_repo",
  description:
    "Clone a git repository into your working directory (channel tasks only). " +
    "Use this once you've determined a coding task needs a specific repo. " +
    "Returns the local path to cd into. Prefer repos named in the channel CONTEXT.md.",
  schema: cloneRepoSchema,
  alwaysLoad: true,
  isEnabled: (_ctx, meta) => meta?.channelMode === true,
  handler: async (ctx, args): Promise<LocalToolResult> => {
    const { repo, branch } = args;
    const token = resolveGithubToken() ?? ctx.token;

    const isOwnerRepo = OWNER_REPO_RE.test(repo);
    const isHttpsUrl = /^https:\/\/github\.com\//.test(repo);
    if (!isOwnerRepo && !isHttpsUrl) {
      return fail(
        `clone_repo: invalid repo "${repo}". Pass 'owner/repo' or a full https://github.com/... URL.`,
      );
    }

    const slug = isOwnerRepo
      ? repo
      : repo.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
    const repoName = slug.split("/").pop() ?? "repo";
    const targetPath = path.join(ctx.cwd, "repos", slug);

    // GitHub accepts a token as the basic-auth username for https clones; this
    // covers private repos. Public repos clone fine without it.
    const cloneUrl = token
      ? `https://x-access-token:${token}@github.com/${slug}.git`
      : `https://github.com/${slug}.git`;

    try {
      const result = await new CloneSaga().run({
        repoUrl: cloneUrl,
        targetPath,
      });
      if (!result.success) {
        return fail(`clone_repo failed: ${result.error}`);
      }

      if (branch) {
        try {
          await createGitClient(targetPath).checkout(branch);
        } catch (err) {
          return fail(
            `Cloned ${slug} to ${targetPath} but failed to check out branch "${branch}": ${
              err instanceof Error ? err.message : String(err)
            }. The default branch is checked out instead.`,
          );
        }
      }

      const checkedOut = (await getCurrentBranch(targetPath)) ?? branch ?? null;
      return {
        content: [
          {
            type: "text",
            text: `Cloned ${slug} (${repoName}) to ${targetPath}${
              checkedOut ? ` on branch ${checkedOut}` : ""
            }. cd into this path for all git and file work in this repo.`,
          },
        ],
      };
    } catch (err) {
      return fail(
        `clone_repo failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});
