import { isCloudRun } from "../../../utils/common";
import {
  runSignedCommitTool,
  SIGNED_COMMIT_TOOL_DESCRIPTION,
  SIGNED_COMMIT_TOOL_NAME,
  signedCommitToolSchema,
} from "../../signed-commit-shared";
import { defineLocalTool } from "../registry";

/**
 * `git_signed_commit` as a local tool. Cloud runs only, and only when a GitHub
 * token is available (the commit is created via GitHub's API, which also signs
 * it). Committing is core to cloud tasks, so keep it visible past ToolSearch.
 */
export const signedCommitTool = defineLocalTool({
  name: SIGNED_COMMIT_TOOL_NAME,
  description: SIGNED_COMMIT_TOOL_DESCRIPTION,
  schema: signedCommitToolSchema,
  alwaysLoad: true,
  isEnabled: (ctx, meta) => isCloudRun(meta) && !!ctx.token,
  handler: (ctx, args) =>
    runSignedCommitTool(
      { cwd: ctx.cwd, token: ctx.token ?? "", taskId: ctx.taskId },
      args,
    ),
});
