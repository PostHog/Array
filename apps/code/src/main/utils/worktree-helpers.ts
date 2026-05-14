import { existsSync } from "node:fs";
import path from "node:path";
import { getWorktreeLocation } from "../services/settingsStore";

/**
 * Resolve a worktree's path on disk by probing both supported layouts (modern
 * `{base}/{name}/{repo}` and pre-2026 legacy `{base}/{repo}/{name}`). Returns
 * whichever exists, defaulting to modern. Replaces an earlier shape-based regex.
 */
export function deriveWorktreePath(
  folderPath: string,
  worktreeName: string,
): string {
  const base = getWorktreeLocation();
  const repoName = path.basename(folderPath);
  const modernPath = path.join(base, worktreeName, repoName);
  const legacyPath = path.join(base, repoName, worktreeName);

  if (existsSync(modernPath)) return modernPath;
  if (existsSync(legacyPath)) return legacyPath;
  return modernPath;
}
