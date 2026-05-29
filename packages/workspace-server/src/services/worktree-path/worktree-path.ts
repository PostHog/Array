import { access } from "node:fs/promises";
import path from "node:path";

function newFormat(base: string, repoName: string, worktreeName: string) {
  return path.join(base, worktreeName, repoName);
}
function legacyFormat(base: string, repoName: string, worktreeName: string) {
  return path.join(base, repoName, worktreeName);
}

/**
 * Worktree path by name heuristic: numeric names use the new
 * `<base>/<name>/<repo>` layout, everything else the legacy `<base>/<repo>/<name>`.
 */
export function deriveWorktreePath(
  worktreeBasePath: string,
  folderPath: string,
  worktreeName: string,
): string {
  const repoName = path.basename(folderPath);
  const isLegacy = !/^\d+$/.test(worktreeName);
  return isLegacy
    ? legacyFormat(worktreeBasePath, repoName, worktreeName)
    : newFormat(worktreeBasePath, repoName, worktreeName);
}

/**
 * Worktree path by probing disk: prefer the new-format path if it exists, else
 * the legacy path if it exists, else fall back to new-format. Used when
 * resolving an already-created worktree whose layout is unknown.
 */
export async function resolveWorktreePathByProbe(
  worktreeBasePath: string,
  folderPath: string,
  worktreeName: string,
): Promise<string> {
  const repoName = path.basename(folderPath);
  const newPath = newFormat(worktreeBasePath, repoName, worktreeName);
  const legacyPath = legacyFormat(worktreeBasePath, repoName, worktreeName);

  try {
    await access(newPath);
    return newPath;
  } catch {}
  try {
    await access(legacyPath);
    return legacyPath;
  } catch {}
  return newPath;
}
