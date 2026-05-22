import type { LocalTool, LocalToolCtx, LocalToolGateMeta } from "./registry";
import { signedCommitTool } from "./tools/signed-commit";

export {
  LOCAL_TOOLS_MCP_NAME,
  type LocalTool,
  type LocalToolCtx,
  type LocalToolGateMeta,
  type LocalToolResult,
  qualifiedLocalToolName,
} from "./registry";

/** Every tool the general local MCP server can expose. Add new tools here. */
export const LOCAL_TOOLS: LocalTool[] = [signedCommitTool];

/** Tools whose gate passes for the given context — the set to actually expose. */
export function enabledLocalTools(
  ctx: LocalToolCtx,
  meta: LocalToolGateMeta | undefined,
): LocalTool[] {
  return LOCAL_TOOLS.filter((t) => t.isEnabled(ctx, meta));
}
