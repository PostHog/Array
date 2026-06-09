import * as fs from "node:fs";
import path from "node:path";
import { getWorktreeLocation } from "../services/settingsStore";

/**
 * Resolves a worktree's on-disk path. Prefers the current layout
 * (`<base>/<name>/<repo>`) and falls back to the legacy `<base>/<repo>/<name>`.
 * Checks disk rather than the name: names are now slugs, not numbers.
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
