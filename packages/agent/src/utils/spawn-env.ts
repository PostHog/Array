import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { delimiter, join } from "node:path";
import { buildNodeShimScript } from "@posthog/shared/node-shim";

// Removes PATH entries that alias `node` to the current executable, whether a
// legacy symlink or the wrapper script written by ensureNodeShim. Codex
// children must not resolve `node` to Electron's bundled runtime: native
// modules they install target the real node ABI.
export function stripElectronNodeShimFromPath(
  pathValue: string | undefined,
  execPath: string = process.execPath,
): string | undefined {
  if (!pathValue) return pathValue;
  return pathValue
    .split(delimiter)
    .filter((dir) => dir && !isElectronNodeShimDir(dir, execPath))
    .join(delimiter);
}

function isElectronNodeShimDir(dir: string, execPath: string): boolean {
  const shimPath = join(dir, "node");
  try {
    if (lstatSync(shimPath).isSymbolicLink()) {
      return readlinkSync(shimPath) === execPath;
    }
    return readFileSync(shimPath, "utf-8") === buildNodeShimScript(execPath);
  } catch {
    return false;
  }
}
