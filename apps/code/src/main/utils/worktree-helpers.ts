import * as fs from "node:fs";
import path from "node:path";
import { getWorktreeLocation } from "../services/settingsStore";

/**
 * Resolves the on-disk path of a worktree, matching WorktreeManager's layout
 * (`<base>/<name>/<repo>`). Older worktrees used `<base>/<repo>/<name>`, so we
 * fall back to that when the new layout isn't present on disk.
 *
 * This must be filesystem-aware rather than guessing from the name: worktree
 * names are now human-readable slugs (e.g. "plucky-summit-59"), so the name
 * alone no longer indicates which layout was used.
 */
export function deriveWorktreePath(
  folderPath: string,
  worktreeName: string,
): string {
  const worktreeBasePath = getWorktreeLocation();
  const repoName = path.basename(folderPath);

  const newFormatPath = path.join(worktreeBasePath, worktreeName, repoName);
  const legacyFormatPath = path.join(worktreeBasePath, repoName, worktreeName);

  if (fs.existsSync(newFormatPath)) return newFormatPath;
  if (fs.existsSync(legacyFormatPath)) return legacyFormatPath;
  return newFormatPath;
}
