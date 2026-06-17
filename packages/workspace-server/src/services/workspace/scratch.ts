import path from "node:path";

/**
 * Folder holding per-task scratch working directories for repo-less channel
 * tasks (the "generic chat box"). A repo-less channel session runs here instead
 * of in a git workspace; the agent clones a repo into a subdirectory only if it
 * decides it needs one.
 *
 * The name is shared so both the WorkspaceService (which creates scratch dirs)
 * and the AgentService (which detects them to enable channel-mode behavior)
 * agree on it without one importing the other's service.
 */
export const SCRATCH_DIR_NAME = "posthog-code-scratch";

/** Base directory for scratch dirs: a sibling of the worktree location. */
export function scratchBasePath(worktreeLocation: string): string {
  return path.join(path.dirname(worktreeLocation), SCRATCH_DIR_NAME);
}

/** Whether a working directory is a repo-less channel scratch dir. */
export function isScratchPath(workingDir: string): boolean {
  return workingDir.split(path.sep).includes(SCRATCH_DIR_NAME);
}
